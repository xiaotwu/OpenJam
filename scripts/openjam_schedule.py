"""Reconcile OpenJam offsite jobs when an operating system scheduler invokes a tick."""

from datetime import datetime, timezone
import os
from pathlib import Path
import tarfile
from types import SimpleNamespace
from urllib import parse, request
import uuid

import openjam_offsite as offsite

FORMAT = "openjam-offsite-schedule-v1"
STATE = "schedule.json"
DEFAULTS = {
    "backupIntervalMinutes": 720,
    "backupOffsetMinutesUtc": 60,
    "monitorIntervalMinutes": 15,
    "retentionAfterMinuteUtc": 125,
    "retryDelaySeconds": 300,
    "maxBackupBytes": offsite.DEFAULT_LIMIT,
}
PATHS = ("replica", "scheduleState", "stage", "recipients", "alertTokenFile")
FIELDS = set(PATHS) | set(DEFAULTS) | {"repositoryId", "sourceUrl", "alertUrl"}


def slot_at(now, minutes, offset_minutes=0):
    interval = minutes * 60
    anchor = offset_minutes * 60
    return (int(now.timestamp()) - anchor) // interval * interval + anchor


def slot_time(slot):
    return datetime.fromtimestamp(slot, timezone.utc).isoformat()


def config_for(path, role):
    _, values = offsite.read_metadata(path)
    unknown = values.keys() - FIELDS
    if unknown:
        raise offsite.OffsiteError("Unknown schedule configuration fields: " + ", ".join(sorted(unknown)))
    config = {**DEFAULTS, **values}
    required = {"replica", "scheduleState", "repositoryId"}
    if role == "backup":
        required.update(("stage", "recipients", "sourceUrl"))
    for key in required:
        if not isinstance(config.get(key), str) or not config[key]:
            raise offsite.OffsiteError(f"Set {key} in the schedule configuration.")
    for key in PATHS:
        if key in config:
            if not isinstance(config[key], str) or not Path(config[key]).is_absolute():
                raise offsite.OffsiteError(f"Set an absolute path for {key}.")
            config[key] = Path(config[key])
    for key, minimum, maximum in (
        ("backupIntervalMinutes", 1, 1440), ("monitorIntervalMinutes", 1, 1440),
        ("backupOffsetMinutesUtc", 0, 1439), ("retentionAfterMinuteUtc", 0, 1439),
        ("retryDelaySeconds", 5, 3600), ("maxBackupBytes", offsite.BUFFER, 1024**4),
    ):
        value = config[key]
        if type(value) is not int or not minimum <= value <= maximum:
            raise offsite.OffsiteError(f"Invalid schedule value for {key}.")
    for key in ("backupIntervalMinutes", "monitorIntervalMinutes"):
        if 1440 % config[key]:
            raise offsite.OffsiteError(f"{key} must divide a UTC day evenly.")
    if config["backupOffsetMinutesUtc"] >= config["backupIntervalMinutes"]:
        raise offsite.OffsiteError("The UTC backup offset must be shorter than the backup interval.")
    if "alertUrl" in config:
        config["alertUrl"] = alert_url(config["alertUrl"])
    if "alertTokenFile" in config and "alertUrl" not in config:
        raise offsite.OffsiteError("Set alertUrl before configuring an alert token.")
    return config


def alert_url(value):
    if not isinstance(value, str):
        raise offsite.OffsiteError("Set an HTTPS alert URL or a loopback HTTP URL for testing.")
    url = parse.urlsplit(value)
    if (not url.hostname or url.username is not None or url.password is not None or url.fragment
            or (url.scheme != "https" and not (url.scheme == "http" and url.hostname in {"127.0.0.1", "::1"}))):
        raise offsite.OffsiteError("Set an HTTPS alert URL or a loopback HTTP URL for testing.")
    # Reject malformed ports during configuration instead of when delivering an alert.
    _ = url.port
    return value


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def deliver(config, event):
    headers = {"Content-Type": "application/json", "Idempotency-Key": event["id"]}
    if "alertTokenFile" in config:
        path = offsite.regular(config["alertTokenFile"])
        if path.stat().st_mode & 0o077:
            raise offsite.OffsiteError("The alert token file must have mode 0600.")
        token = offsite.read_small(path).decode("ascii").strip()
        if not token or any(not 33 <= ord(char) <= 126 for char in token):
            raise offsite.OffsiteError("The alert token file is invalid.")
        headers["Authorization"] = "Bearer " + token
    outgoing = request.Request(config["alertUrl"], data=offsite.encode(event), headers=headers, method="POST")
    with request.build_opener(NoRedirect()).open(outgoing, timeout=5) as response:
        if not 200 <= response.status < 300:
            raise offsite.OffsiteError("Alert receiver did not acknowledge the event.")


class BackupOutput(offsite.Reporter):
    def __init__(self, project):
        super().__init__(project)
        self.verified = None

    def emit(self, event, **details):
        super().emit(event, **details)
        if event == "replica_verified":
            self.verified = details


class Schedule:
    def __init__(self, args, config, directory, run_backup, ops_error):
        self.args = args
        self.config = config
        self.directory = directory
        self.run_backup = run_backup
        self.report = offsite.Reporter(args.project)
        self.caught = (offsite.OffsiteError, OSError, ValueError, KeyError, tarfile.TarError, ops_error)
        binding = {"format": FORMAT, "deployment": args.project, "repositoryId": config["repositoryId"], "role": args.role}
        path = directory / STATE
        self.state = {**binding, "alerts": {}}
        if offsite.present(path):
            _, self.state = offsite.read_metadata(path)
            if (any(self.state.get(k) != value for k, value in binding.items())
                    or not isinstance(self.state.get("alerts"), dict)):
                raise offsite.OffsiteError("Schedule state belongs to a different deployment, repository or role.")

    def save(self):
        temporary = self.directory / (STATE + ".partial")
        if offsite.present(temporary):
            offsite.regular(temporary).unlink()
        offsite.write_file(temporary, offsite.encode(self.state))
        os.replace(temporary, self.directory / STATE)
        offsite.sync_dir(self.directory)

    def store(self):
        root = offsite.private_dir(self.config["replica"])
        return root, offsite.replica(root, self.args.project, self.config["repositoryId"])

    def status(self, now):
        root, repo = self.store()
        return offsite.monitor(root, repo, now)

    def notify(self, scope, event, level, **details):
        alerts = self.state["alerts"]
        previous = alerts.get(scope)
        if previous and not previous["resolved"]:
            old = previous["payload"]
            if old["event"] == event and old["level"] == level:
                return
        payload = {"id": str(uuid.uuid4()), "deployment": self.args.project, "event": event, "level": level,
                   "at": offsite.now_utc().isoformat(), **details}
        alerts[scope] = {"payload": payload, "resolved": False, "delivered": "alertUrl" not in self.config}
        self.save()
        self.report.emit("schedule_alert", level=level, alertEvent=event, alertId=payload["id"])

    def resolve(self, scope):
        alerts = self.state["alerts"]
        item = alerts.get(scope)
        if item is not None:
            if item["delivered"]:
                del alerts[scope]
            else:
                item["resolved"] = True

    def send_alerts(self):
        success = True
        alerts = self.state["alerts"]
        for scope, item in list(alerts.items()):
            if item["delivered"]:
                continue
            payload = item["payload"]
            try:
                deliver(self.config, payload)
            except (OSError, ValueError, offsite.OffsiteError) as exc:
                self.report.emit("schedule_alert_delivery_failed", level="critical",
                                 alertId=payload["id"], failure=type(exc).__name__)
                success = False
                continue
            if item["resolved"]:
                del alerts[scope]
            else:
                item["delivered"] = True
            self.save()
            self.report.emit("schedule_alert_delivered", alertId=payload["id"], alertEvent=payload["event"])
        return success

    def monitor_due(self, now):
        slot = slot_at(now, self.config["monitorIntervalMinutes"])
        if self.state.get("monitorSlot", -1) >= slot:
            return True
        try:
            status = self.status(now)
        except offsite.OffsiteBusy:
            return True
        except self.caught as exc:
            status = {"level": "critical", "failure": type(exc).__name__}
        self.state["monitorSlot"] = slot
        level = status.pop("level")
        self.report.emit("schedule_monitor", level=level, **status)
        if level == "ok":
            self.resolve("monitor")
        else:
            self.notify("monitor", "replica_age" if "ageSeconds" in status else "replica_unavailable",
                        level, **status)
        self.save()
        return level == "ok"

    def verified_for(self, info, slot):
        return (info and info.get("capturedAt") and info.get("level", "ok") == "ok"
                and offsite.instant(info["capturedAt"]).timestamp() >= slot)

    def finish_backup_slot(self, slot, info, adopted):
        self.state["backupSlot"] = slot
        self.state.pop("retryAt", None)
        self.resolve("backup")
        self.resolve("monitor")
        self.save()
        self.report.emit("schedule_backup_verified", slot=slot_time(slot), point=info["point"],
                         receiptSha256=info["receiptSha256"], adopted=adopted)

    def capture(self, slot):
        settings = self.config
        run_args = SimpleNamespace(
            project=self.args.project, env_file=self.args.env_file, offsite="run",
            replica=settings["replica"], repository_id=settings["repositoryId"],
            state=settings["stage"], recipients=settings["recipients"], url=settings["sourceUrl"],
            max_backup_bytes=settings["maxBackupBytes"], attempts=3, retry_delay_seconds=5,
            confirm_resumed=False, alert_command=None,
        )
        # An older pending point can use the first call. Take a fresh point for
        # this window in the second call if the pending one predates it.
        for _ in range(2):
            reporter = BackupOutput(self.args.project)
            try:
                result = self.run_backup(run_args, reporter)
            except self.caught:
                if self.verified_for(reporter.verified, slot):
                    self.finish_backup_slot(slot, reporter.verified, False)
                raise
            if self.verified_for(reporter.verified, slot):
                self.finish_backup_slot(slot, reporter.verified, False)
                return
            if result or not reporter.verified:
                break
        raise offsite.OffsiteError("No verified recovery point covered the scheduled window.")

    def backup_due(self, now):
        interval = self.config["backupIntervalMinutes"]
        slot = slot_at(now, interval, self.config["backupOffsetMinutesUtc"])
        last = self.state.get("backupSlot")
        if (last is not None and last >= slot) or self.state.get("retryAt", 0) > now.timestamp():
            return True
        try:
            info = self.status(now)
            if self.verified_for(info, slot):
                self.finish_backup_slot(slot, info, True)
                return True
            gap = (slot - last) // (interval * 60) - 1 if last is not None else 0
            self.report.emit("schedule_backup_due", slot=slot_time(slot), coalescedSlots=max(0, gap),
                             secondsLate=round(now.timestamp() - slot, 3))
            self.capture(slot)
        except offsite.OffsiteBusy:
            return True
        except self.caught as exc:
            self.state["retryAt"] = int(offsite.now_utc().timestamp()) + self.config["retryDelaySeconds"]
            self.notify("backup", "scheduled_backup_failed", "critical",
                        slot=slot_time(slot), failure=type(exc).__name__)
            self.save()
            return False
        return True

    def retention_due(self, now):
        day = slot_at(now, 1440)
        cutoff = day + self.config["retentionAfterMinuteUtc"] * 60
        if now.timestamp() < cutoff or self.state.get("retentionDay", -1) >= day:
            return True
        if self.state.get("retryAt", 0) > now.timestamp():
            return True
        try:
            root, repo = self.store()
            info = offsite.monitor(root, repo, now)
            first_backup = day + self.config["backupOffsetMinutesUtc"] * 60
            if not self.verified_for(info, first_backup):
                return True
            result = offsite.prune(root, repo, now, True)
        except offsite.OffsiteBusy:
            return True
        except self.caught as exc:
            self.state["retryAt"] = int(offsite.now_utc().timestamp()) + self.config["retryDelaySeconds"]
            self.notify("retention", "scheduled_retention_failed", "critical", failure=type(exc).__name__)
            self.save()
            return False
        self.state["retentionDay"] = day
        self.state.pop("retryAt", None)
        self.resolve("retention")
        self.save()
        self.report.emit("schedule_retention", day=slot_time(day), **result)
        return True


def tick(args, run_backup, ops_error):
    config = config_for(args.config, args.role)
    directory = offsite.private_dir(config["scheduleState"])
    if directory.is_relative_to(config["replica"].resolve()):
        raise offsite.OffsiteError("Keep the schedule state outside the replica so outages can be reported.")
    if args.role == "backup" and directory.is_relative_to(config["stage"].resolve()):
        raise offsite.OffsiteError("Keep the schedule state outside the backup staging directory.")
    lock = directory / offsite.LOCK
    try:
        offsite.write_file(lock, b"")
    except FileExistsError:
        pass
    try:
        with offsite.locked(lock):
            schedule = Schedule(args, config, directory, run_backup, ops_error)
            now = offsite.now_utc()
            if args.role == "retention":
                jobs_ok = schedule.retention_due(now)
            else:
                monitor_ok = schedule.monitor_due(now)
                backup_ok = schedule.backup_due(now)
                jobs_ok = monitor_ok and backup_ok
            delivered = schedule.send_alerts()
            return 0 if jobs_ok and delivered else 1
    except offsite.OffsiteBusy:
        # Another tick already owns this role's state.
        return 0
