"""Encrypted offsite recovery points for the default Shiori Compose deployment."""

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid

REPOSITORY = ".openjam-replica.json"
LOCK = ".openjam-lock"
JOB = "job.json"
RESUME = "resume-required"
RECEIPT = "receipt.json"
MANIFEST = "manifest.json"
FILES = (MANIFEST, "postgres.dump", "seaweedfs.tar")
CIPHERTEXT = {name + ".age" for name in FILES}
ENVELOPE = CIPHERTEXT | {RECEIPT}
AGE_HEADER = b"age-encryption.org/v1\n"
POINT = re.compile(r"[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}")
SHA256 = re.compile(r"[0-9a-f]{64}")
DEPLOYMENT = re.compile(r"[a-z0-9][a-z0-9_-]{0,62}")
AGE_KEY = "[023456789acdefghjklmnpqrstuvwxyz]"
RECIPIENT = re.compile(r"age1" + AGE_KEY + r"{58}|age1pq1" + AGE_KEY + r"{1000,2500}")
REPO_FORMAT = "openjam-offsite-repository-v1"
POINT_FORMAT = "openjam-offsite-point-v1"
JOB_FORMAT = "openjam-offsite-job-v1"
BUFFER = 1024 * 1024
MARGIN = 32 * BUFFER
DEFAULT_LIMIT = 2 * 1024**3
META_LIMIT = 16 * 1024


class OffsiteError(Exception):
    pass


class OffsiteBusy(OffsiteError):
    pass


def now_utc():
    return datetime.now(timezone.utc)


def instant(value):
    if not isinstance(value, str) or len(value) > 40:
        raise OffsiteError("Invalid recovery point timestamp.")
    try:
        result = datetime.fromisoformat(value[:-1] + "+00:00" if value.endswith("Z") else value)
    except ValueError:
        raise OffsiteError("Invalid recovery point timestamp.") from None
    if result.utcoffset() is None or result.utcoffset() != timedelta():
        raise OffsiteError("Recovery point timestamps must be in UTC.")
    return result.astimezone(timezone.utc)


def point_id(at, manifest_hash):
    return at.strftime("%Y%m%dT%H%M%SZ") + "-" + manifest_hash[:16]


def private_dir(path):
    if path.is_symlink() or not path.is_dir() or path.stat().st_mode & 0o077:
        raise OffsiteError("Use an existing private directory (mode 0700) without a symbolic link.")
    return path.resolve()


def regular(path):
    if not stat.S_ISREG(path.lstat().st_mode):
        raise OffsiteError("Expected a regular file, not a link or special file.")
    return path


def present(path):
    return path.exists() or path.is_symlink()


def read_small(path):
    with regular(path).open("rb") as src:
        data = src.read(META_LIMIT + 1)
    if len(data) > META_LIMIT:
        raise OffsiteError("An offsite metadata file exceeds the size limit.")
    return data


def read_metadata(path):
    try:
        data = read_small(path)
        value = json.loads(data)
    except (ValueError, UnicodeError):
        raise OffsiteError("An offsite metadata file is invalid.") from None
    if not isinstance(value, dict):
        raise OffsiteError("An offsite metadata file is invalid.")
    return data, value


def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def write_file(path, data):
    with path.open("xb") as out:
        out.write(data)
        out.flush()
        os.fsync(out.fileno())


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def discard(path, allowed):
    """Remove only known, regular files from a reserved private staging directory."""
    if not present(path):
        return
    private_dir(path)
    files = list(path.iterdir())
    if any(file.name not in allowed for file in files):
        raise OffsiteError("Unexpected entry in managed staging; inspect it before retrying.")
    for file in files:
        regular(file)
    for file in files:
        file.unlink()
    path.rmdir()


@contextmanager
def locked(path, shared=False):
    import fcntl

    fd = os.open(regular(path), os.O_RDONLY | os.O_NOFOLLOW)
    try:
        try:
            fcntl.flock(fd, (fcntl.LOCK_SH if shared else fcntl.LOCK_EX) | fcntl.LOCK_NB)
        except BlockingIOError:
            raise OffsiteBusy("Another offsite operation holds this lock. Retry when it finishes.") from None
        yield
    finally:
        os.close(fd)


def capacity(path, needed):
    if shutil.disk_usage(path).free < needed + MARGIN:
        raise OffsiteError("Insufficient space for this operation and the staging reserve.")


def hash_file(path, size=None):
    digest = hashlib.sha256()
    total = 0
    with regular(path).open("rb") as src:
        if size is not None and os.fstat(src.fileno()).st_size != size:
            raise OffsiteError("Offsite ciphertext size or SHA-256 mismatch.")
        if size is not None:
            header = src.read(len(AGE_HEADER))
            if header != AGE_HEADER:
                raise OffsiteError("Offsite file does not have an age ciphertext header.")
            digest.update(header)
            total = len(header)
        while chunk := src.read(BUFFER):
            digest.update(chunk)
            total += len(chunk)
            if size is not None and total > size:
                raise OffsiteError("Offsite ciphertext changed during verification.")
    return {"bytes": total, "sha256": digest.hexdigest()}


def check_cipher(path, info):
    if hash_file(path, info["bytes"]) != {k: info[k] for k in ("bytes", "sha256")}:
        raise OffsiteError("Offsite ciphertext size or SHA-256 mismatch.")


def copy_cipher(src, dst, info):
    remaining = info["bytes"]
    with regular(src).open("rb") as incoming, dst.open("xb") as out:
        if os.fstat(incoming.fileno()).st_size != remaining:
            raise OffsiteError("Offsite ciphertext size or SHA-256 mismatch.")
        while chunk := incoming.read(BUFFER):
            remaining -= len(chunk)
            if remaining < 0:
                raise OffsiteError("Offsite ciphertext changed during transfer.")
            out.write(chunk)
        out.flush()
        os.fsync(out.fileno())
    check_cipher(dst, info)


def age_command(mode, key):
    binary = shutil.which("age")
    if not binary:
        raise OffsiteError("Install age on this host before using the offsite command.")
    regular(key)
    if mode == "encrypt":
        lines = [line.strip() for line in read_small(key).decode("ascii").splitlines()]
        keys = [line for line in lines if line and not line.startswith("#")]
        if not 1 <= len(keys) <= 4 or not all(RECIPIENT.fullmatch(line) for line in keys):
            raise OffsiteError("Supply one to four native age public recipients in a separate file.")
        return [binary, "--encrypt", "--recipients-file", str(key)]
    if key.stat().st_mode & 0o077:
        raise OffsiteError("The recovery identity must be a private file (mode 0600).")
    return [binary, "--decrypt", "--identity", str(key)]


def age_file(command, src, dst):
    with regular(src).open("rb") as incoming, dst.open("xb") as out:
        result = subprocess.run(command, stdin=incoming, stdout=out, stderr=subprocess.DEVNULL)
        if result.returncode:
            raise OffsiteError("age failed. Check the recipients or recovery identity and the archive.")
        out.flush()
        os.fsync(out.fileno())


def read_point(path, repo, *, expected=None):
    private_dir(path)
    data, meta = read_metadata(path / RECEIPT)
    receipt_hash = hashlib.sha256(data).hexdigest()
    if expected and receipt_hash != expected:
        raise OffsiteError("Replica receipt SHA-256 differs from the trusted record.")
    if (meta.get("format") != POINT_FORMAT or meta.get("repositoryId") != repo["repositoryId"]
            or meta.get("deployment") != repo["deployment"]):
        raise OffsiteError("Recovery point belongs to a different replica or deployment.")
    at = instant(meta.get("capturedAt"))
    manifest_hash = meta.get("manifestSha256")
    if (not isinstance(manifest_hash, str) or not SHA256.fullmatch(manifest_hash)
            or meta.get("point") != point_id(at, manifest_hash)):
        raise OffsiteError("Recovery point metadata does not match its identifier.")
    files = meta.get("files")
    if not isinstance(files, dict) or set(files) != set(FILES) or {p.name for p in path.iterdir()} != ENVELOPE:
        raise OffsiteError("The offsite recovery point is incomplete or contains extra files.")
    for info in files.values():
        if (not isinstance(info, dict) or type(info.get("bytes")) is not int or type(info.get("plainBytes")) is not int
                or not 0 < info["plainBytes"] < info["bytes"] <= info["plainBytes"] + info["plainBytes"] // 1024 + META_LIMIT
                or not isinstance(info.get("sha256"), str) or not SHA256.fullmatch(info["sha256"])):
            raise OffsiteError("Offsite file metadata is invalid.")
    return data, meta, receipt_hash


def verify_point(path, repo, expected=None):
    data, meta, receipt_hash = read_point(path, repo, expected=expected)
    for name, info in meta["files"].items():
        check_cipher(path / (name + ".age"), info)
    return data, meta, receipt_hash


def init_replica(path, deployment):
    root = private_dir(path)
    if any(root.iterdir()):
        raise OffsiteError("Initialize a new, empty replica directory.")
    info = {"format": REPO_FORMAT, "deployment": deployment, "repositoryId": str(uuid.uuid4())}
    write_file(root / LOCK, b"")
    write_file(root / REPOSITORY, encode(info))
    sync_dir(root)
    return info


def replica(root, deployment, repository_id):
    if not present(root / REPOSITORY):
        raise OffsiteError("Replica marker is missing. Check the configured mount.")
    _, info = read_metadata(root / REPOSITORY)
    if info != {"format": REPO_FORMAT, "deployment": deployment, "repositoryId": repository_id}:
        raise OffsiteError("Replica marker does not match the configured deployment and repository ID.")
    return info


def seal(raw, sealed, repo, command, verify_backup, max_bytes):
    info = verify_backup(raw)
    manifest = hash_file(raw / MANIFEST)
    at = instant(info.get("createdAt"))
    sizes = {name: info["files"][name]["bytes"] if name != MANIFEST else manifest["bytes"] for name in FILES}
    if sum(sizes.values()) > max_bytes + META_LIMIT:
        raise OffsiteError("Pending backup exceeds the configured size limit.")
    capacity(sealed.parent, sum(sizes.values()) + MARGIN)
    incoming = sealed.with_name("sealing")
    discard(incoming, ENVELOPE)
    incoming.mkdir(mode=0o700)
    try:
        meta = {"format": POINT_FORMAT, "repositoryId": repo["repositoryId"], "deployment": repo["deployment"],
                "capturedAt": at.isoformat(), "point": point_id(at, manifest["sha256"]),
                "manifestSha256": manifest["sha256"], "files": {}}
        for name, size in sizes.items():
            encrypted = incoming / (name + ".age")
            age_file(command, raw / name, encrypted)
            meta["files"][name] = {**hash_file(encrypted), "plainBytes": size}
        write_file(incoming / RECEIPT, encode(meta))
        read_point(incoming, repo)
        sync_dir(incoming)
        incoming.rename(sealed)
        sync_dir(sealed.parent)
    finally:
        discard(incoming, ENVELOPE)


def publish(root, repo, sealed):
    data, meta, receipt_hash = read_point(sealed, repo)
    point = meta["point"]
    with locked(root / LOCK):
        replica(root, repo["deployment"], repo["repositoryId"])
        incoming = root / ".incoming"
        discard(incoming, ENVELOPE)
        final = root / point
        if present(final):
            verify_point(final, repo, expected=receipt_hash)
            sync_dir(root)
            return meta, receipt_hash
        capacity(root, sum(info["bytes"] for info in meta["files"].values()))
        incoming.mkdir(mode=0o700)
        try:
            for name, info in meta["files"].items():
                cipher = name + ".age"
                copy_cipher(sealed / cipher, incoming / cipher, info)
            write_file(incoming / RECEIPT, data)
            read_point(incoming, repo, expected=receipt_hash)
            sync_dir(incoming)
            incoming.rename(final)
            sync_dir(root)
        finally:
            discard(incoming, ENVELOPE)
    return meta, receipt_hash


def fetch(root, repo, point, destination, command, verify_backup, expected, max_bytes):
    if not POINT.fullmatch(point):
        raise OffsiteError("Supply the exact recovery point identifier.")
    if expected is not None and not SHA256.fullmatch(expected):
        raise OffsiteError("Expected receipt hash must be a SHA-256 hex digest.")
    dest_parent = private_dir(destination.parent)
    dest = dest_parent / destination.name
    if present(dest) or dest_parent == root or root in dest_parent.parents:
        raise OffsiteError("Choose a new recovery directory outside the replica, under a private parent.")
    start = time.monotonic()
    with tempfile.TemporaryDirectory(prefix=".shiori-fetch-", dir=dest_parent) as stage:
        stage = Path(stage)
        with locked(root / LOCK, shared=True):
            replica(root, repo["deployment"], repo["repositoryId"])
            _, meta, receipt_hash = read_point(root / point, repo, expected=expected)
            if meta["point"] != point:
                raise OffsiteError("Recovery point directory name does not match its receipt.")
            files = meta["files"]
            plain = sum(info["plainBytes"] for info in files.values())
            if plain > max_bytes + META_LIMIT:
                raise OffsiteError("Recovery point exceeds the configured size limit.")
            capacity(stage, plain + sum(info["bytes"] for info in files.values()))
            for name, info in files.items():
                cipher = name + ".age"
                copy_cipher(root / point / cipher, stage / cipher, info)
        fetched = time.monotonic()
        plaintext = stage / "plain"
        plaintext.mkdir(mode=0o700)
        for name, info in files.items():
            clear = plaintext / name
            age_file(command, stage / (name + ".age"), clear)
            if clear.stat().st_size != info["plainBytes"]:
                raise OffsiteError("Decrypted file size differs from the recovery receipt.")
        decrypted = time.monotonic()
        if hash_file(plaintext / MANIFEST)["sha256"] != meta["manifestSha256"]:
            raise OffsiteError("Decrypted manifest SHA-256 differs from the recovery receipt.")
        result = verify_backup(plaintext)
        if instant(result.get("createdAt")) != instant(meta["capturedAt"]):
            raise OffsiteError("Decrypted backup has a different recovery point timestamp.")
        sync_dir(plaintext)
        if present(dest):
            raise OffsiteError("Recovery destination already exists.")
        plaintext.rename(dest)
        sync_dir(dest_parent)
    end = time.monotonic()
    return {"point": point, "receiptSha256": receipt_hash, "fetchVerifySeconds": round(fetched-start, 3),
            "decryptSeconds": round(decrypted-fetched, 3), "innerVerifySeconds": round(end-decrypted, 3)}


def inventory(root, repo, now):
    valid, bad = [], []
    for path in sorted(root.iterdir(), reverse=True):
        if not POINT.fullmatch(path.name):
            continue
        try:
            _, meta, receipt_hash = verify_point(path, repo)
            if path.name != meta["point"] or instant(meta["capturedAt"]) > now + timedelta(minutes=5):
                raise OffsiteError("Recovery point name or time is invalid.")
            valid.append((instant(meta["capturedAt"]), path.name, receipt_hash))
        except (OffsiteError, OSError):
            bad.append(path.name)
    return sorted(valid, reverse=True), bad


def monitor(root, repo, now):
    # Check the newest candidates until a good point is found. Pruning and restore
    # drills verify older points separately.
    with locked(root / LOCK, shared=True):
        replica(root, repo["deployment"], repo["repositoryId"])
        bad = []
        for path in sorted(root.iterdir(), reverse=True):
            if not POINT.fullmatch(path.name):
                continue
            try:
                _, meta, receipt_hash = verify_point(path, repo)
                at = instant(meta["capturedAt"])
                if at > now + timedelta(minutes=5) or path.name != meta["point"]:
                    raise OffsiteError("Recovery point name or time is invalid.")
            except (OffsiteError, OSError):
                bad.append(path.name)
                continue
            age = max(0, (now - at).total_seconds())
            level = "critical" if bad or age >= 24 * 3600 else "warning" if age >= 20 * 3600 else "ok"
            return {"level": level, "point": path.name, "capturedAt": at.isoformat(), "ageSeconds": round(age, 3),
                    "receiptSha256": receipt_hash, "invalidNewerPoints": bad}
    return {"level": "critical", "point": None, "ageSeconds": None, "invalidNewerPoints": bad}


def retained(points, now):
    current = now.date()
    monday = current - timedelta(days=current.weekday())
    month = current.year * 12 + current.month
    keep = {point for _, point, _ in points[:2]}
    day_count, weeks, months = {}, set(), set()
    for at, point, _ in points:
        date = min(current, at.date())
        week = (date - timedelta(days=date.weekday()) - monday).days // 7
        calendar_month = date.year * 12 + date.month
        if (current-date).days < 7 and day_count.get(date, 0) < 2:
            keep.add(point)
            day_count[date] = day_count.get(date, 0) + 1
        if -3 <= week <= 0 and week not in weeks:
            keep.add(point)
            weeks.add(week)
        if 0 <= month - calendar_month < 3 and calendar_month not in months:
            keep.add(point)
            months.add(calendar_month)
    return keep


def prune(root, repo, now, apply):
    with locked(root / LOCK, shared=not apply):
        replica(root, repo["deployment"], repo["repositoryId"])
        points, bad = inventory(root, repo, now)
        if bad:
            raise OffsiteError("At least one managed recovery point is invalid; retention will not delete anything.")
        keep = retained(points, now)
        obsolete = [point for _, point, _ in points if point not in keep]
        if apply:
            retired = root / ".retiring"
            discard(retired, ENVELOPE)
            for point in obsolete:
                (root / point).rename(retired)
                sync_dir(root)
                discard(retired, ENVELOPE)
                sync_dir(root)
        return {"applied": apply, "keep": sorted(keep), "remove": obsolete}


class Reporter:
    def __init__(self, deployment, command=None):
        self.deployment = deployment
        self.command = command
        self.delivery_failed = False

    def emit(self, event, *, level="ok", alert=False, **detail):
        data = encode({"event": event, "deployment": self.deployment, "level": level,
                       "at": now_utc().isoformat(), **detail})
        print(data.decode().rstrip(), file=sys.stdout if level == "ok" else sys.stderr, flush=True)
        if alert and self.command:
            try:
                result = subprocess.run([str(self.command)], input=data, stdout=subprocess.DEVNULL,
                                        stderr=subprocess.DEVNULL, timeout=15)
                if result.returncode == 0:
                    return
            except (OSError, subprocess.TimeoutExpired):
                pass
            self.delivery_failed = True
            self.emit("alert_delivery_failed", level="critical")


def finish_job(job):
    # A published point remains usable if the process is interrupted here; the
    # next run can safely finish the same job, instead of taking another backup.
    discard(job / "backup", set(FILES) | {MANIFEST + ".partial"})
    discard(job / "sealing", ENVELOPE)
    discard(job / "sealed", ENVELOPE)
    regular(job / JOB).unlink()
    job.rmdir()
    sync_dir(job.parent)


def compose(stack, *args):
    result = subprocess.run([*stack.args, *args])
    if result.returncode:
        raise OffsiteError("Compose stop or resume failed; check the source services.")


def cycle(args, root, repo, stack, backup, verify_backup, quick_check, reporter, caught):
    state = private_dir(args.state)
    if state == root or root in state.parents or state in root.parents or state.stat().st_dev == root.stat().st_dev:
        raise OffsiteError("The replica must be on a separately mounted filesystem from the local staging directory.")
    # Validate the key before starting downtime. Only public recipients are accepted here.
    command = age_command("encrypt", args.recipients)
    if subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                      stderr=subprocess.DEVNULL).returncode:
        raise OffsiteError("age cannot encrypt to the supplied public recipients.")
    lock = state / LOCK
    try:
        write_file(lock, b"")
    except FileExistsError:
        pass
    with locked(lock):
        if {p.name for p in state.iterdir()} - {LOCK, "pending"}:
            raise OffsiteError("Use a dedicated private offsite staging directory.")
        pending = state / "pending"
        binding = {"format": JOB_FORMAT, "deployment": repo["deployment"], "repositoryId": repo["repositoryId"]}
        if not present(pending):
            pending.mkdir(mode=0o700)
            write_file(pending / JOB, encode(binding))
            sync_dir(pending)
            sync_dir(state)
        private_dir(pending)
        if not list(pending.iterdir()):
            write_file(pending / JOB, encode(binding))
        if read_metadata(pending / JOB)[1] != binding:
            raise OffsiteError("Pending backup belongs to another deployment or replica.")
        if {p.name for p in pending.iterdir()} - {JOB, RESUME, "backup", "sealing", "sealed"}:
            raise OffsiteError("Unexpected entry in the pending backup; inspect it before retrying.")
        flag = pending / RESUME
        if present(flag):
            if not args.confirm_resumed:
                raise OffsiteError("Previous backup was interrupted. Resume and check the source, then use --confirm-resumed.")
            stack.managed_stores(quiesced=False)
            stack.self_check(False, "30s")
            quick_check(args.url)
            regular(flag).unlink()
            sync_dir(pending)
        raw, sealed = pending / "backup", pending / "sealed"
        if not present(sealed):
            if not present(raw / MANIFEST):
                discard(raw, set(FILES) | {MANIFEST + ".partial"})
                capacity(state, 2 * args.max_backup_bytes)
                stack.managed_stores(quiesced=False)
                stack.self_check(False, "30s")
                quick_check(args.url)
                write_file(flag, b"")
                sync_dir(pending)
                started = time.monotonic()
                at = now_utc()
                try:
                    compose(stack, "stop", "--timeout", "30", "server", "worker")
                    compose(stack, "stop", "--timeout", "30", "seaweedfs")
                    capture_start = time.monotonic()
                    backup(stack, raw, captured_at=at, max_bytes=args.max_backup_bytes)
                    reporter.emit("cold_backup", seconds=round(time.monotonic()-capture_start, 3),
                                  capturedAt=at.isoformat())
                finally:
                    compose(stack, "up", "--no-build", "--wait", "--wait-timeout", "120", "server", "worker")
                    quick_check(args.url)
                    regular(flag).unlink()
                    sync_dir(pending)
                    reporter.emit("source_resumed", seconds=round(time.monotonic()-started, 3))
            started = time.monotonic()
            seal(raw, sealed, repo, command, verify_backup, args.max_backup_bytes)
            reporter.emit("sealed", seconds=round(time.monotonic()-started, 3))
        else:
            reporter.emit("retrying_pending_point")
        start = time.monotonic()
        for attempt in range(1, args.attempts+1):
            try:
                meta, receipt_hash = publish(root, repo, sealed)
                break
            except caught as exc:
                reporter.emit("replica_attempt_failed", level="warning", alert=(attempt == 1),
                              attempt=attempt, maxAttempts=args.attempts, failure=type(exc).__name__,
                              errno=getattr(exc, "errno", None))
                if attempt == args.attempts:
                    raise OffsiteError("Replica copy did not verify. The pending point was retained for retry.") from None
                time.sleep(min(60, args.retry_delay_seconds * 2**(attempt-1)))
        reporter.emit("replica_verified", point=meta["point"], capturedAt=meta["capturedAt"],
                      bytes=sum(info["bytes"] for info in meta["files"].values()),
                      receiptSha256=receipt_hash, attempt=attempt, seconds=round(time.monotonic()-start, 3))
        finish_job(pending)


def add_commands(commands):
    offsite = commands.add_parser("offsite", help="manage encrypted copies on a mounted replica")
    sub = offsite.add_subparsers(dest="offsite", required=True)
    tick = sub.add_parser("tick", help="run due backup, monitoring or retention work")
    tick.add_argument("--config", required=True, type=Path)
    tick.add_argument("--role", choices=("backup", "retention"), default="backup")
    for name, help_text in (
        ("init", "initialize an empty private replica directory"),
        ("run", "capture, resume writes, encrypt and copy; retry a pending point first"),
        ("monitor", "verify the newest usable replica and report its age"),
        ("prune", "preview retention; apply only with --apply"),
        ("fetch", "copy, decrypt and verify a point in a new recovery directory"),
    ):
        parser = sub.add_parser(name, help=help_text)
        parser.add_argument("--replica", required=True, type=Path)
        if name != "init":
            parser.add_argument("--repository-id", required=True)
        if name in ("run", "monitor"):
            parser.add_argument("--alert-command", type=Path, help="absolute executable path; receives one JSON event on stdin")
        if name in ("run", "fetch"):
            parser.add_argument("--max-backup-bytes", type=int, default=DEFAULT_LIMIT, help="maximum backup payload (default 2 GiB)")
        if name == "run":
            parser.add_argument("--state", required=True, type=Path)
            parser.add_argument("--recipients", required=True, type=Path)
            parser.add_argument("--url", required=True, help="source HTTP(S) health URL")
            parser.add_argument("--attempts", type=int, default=3)
            parser.add_argument("--retry-delay-seconds", type=int, default=5)
            parser.add_argument("--confirm-resumed", action="store_true", help="acknowledge and verify a manually resumed source")
        if name == "prune":
            parser.add_argument("--apply", action="store_true")
        if name == "fetch":
            parser.add_argument("point")
            parser.add_argument("directory", type=Path)
            parser.add_argument("--identity", required=True, type=Path)
            parser.add_argument("--expect-receipt-sha256", help="SHA-256 from the trusted backup job record")


def run_command(args, compose_type, backup, verify_backup, quick_check, ops_error, *, reporter=None):
    if os.name != "posix":
        raise OffsiteError("Use a Linux or macOS host for the mounted replica commands.")
    if not args.project or not DEPLOYMENT.fullmatch(args.project):
        raise OffsiteError("Use --project NAME for the source deployment recorded on the replica.")
    sub = args.offsite
    if sub == "tick":
        from shiori_schedule import tick

        def run_backup(run_args, output):
            return run_command(run_args, compose_type, backup, verify_backup, quick_check, ops_error, reporter=output)

        return tick(args, run_backup, ops_error)
    caught = (OffsiteError, OSError, ValueError, KeyError, tarfile.TarError, ops_error)
    if reporter is None:
        reporter = Reporter(args.project, getattr(args, "alert_command", None))
    if reporter.command and (not reporter.command.is_absolute() or not reporter.command.is_file()
                             or not os.access(reporter.command, os.X_OK)):
        raise OffsiteError("Choose an absolute path to an executable alert command.")
    try:
        root = private_dir(args.replica)
        if sub == "init":
            reporter.emit("replica_initialized", **{k: v for k, v in init_replica(root, args.project).items()
                                                    if k == "repositoryId"})
            return 0
        repo = replica(root, args.project, args.repository_id)
        if sub == "run":
            if not 1 <= args.attempts <= 5 or not 0 <= args.retry_delay_seconds <= 60 or args.max_backup_bytes < BUFFER:
                raise OffsiteError("Check the backup size and retry limits.")
            # Convert a scheduler's TERM into an interrupt so the write-freeze finally block runs.
            def interrupt(signum, frame):
                raise KeyboardInterrupt
            previous = signal.signal(signal.SIGTERM, interrupt)
            try:
                cycle(args, root, repo, compose_type(args.project, args.env_file), backup, verify_backup,
                      quick_check, reporter, caught)
            finally:
                signal.signal(signal.SIGTERM, previous)
        elif sub == "monitor":
            status = monitor(root, repo, now_utc())
            level = status.pop("level")
            reporter.emit("replica_age", level=level, alert=(level != "ok"), **status)
            return 0 if level == "ok" else 1
        elif sub == "prune":
            reporter.emit("retention", **prune(root, repo, now_utc(), args.apply))
        else:
            if args.max_backup_bytes < BUFFER or args.identity.resolve().is_relative_to(root):
                raise OffsiteError("Keep the identity outside the replica and use a valid size limit.")
            command = age_command("decrypt", args.identity)
            reporter.emit("replica_fetched", **fetch(root, repo, args.point, args.directory, command,
                                                    verify_backup, args.expect_receipt_sha256, args.max_backup_bytes))
    except (caught + (KeyboardInterrupt,)):
        if sub in ("run", "monitor"):
            reporter.emit("backup_run_failed" if sub == "run" else "replica_unavailable", level="critical", alert=True)
        raise
    return 1 if reporter.delivery_failed else 0
