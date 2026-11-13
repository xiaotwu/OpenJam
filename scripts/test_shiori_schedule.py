import io
from contextlib import redirect_stdout, redirect_stderr
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import shiori_offsite as offsite
import shiori_schedule as schedule


NOW = datetime(2026, 11, 12, 13, 7, tzinfo=timezone.utc)
SETTINGS = Path(__file__).parent / "offsite-scheduling"


class ScheduleTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.output = io.StringIO()
        for stream in (redirect_stdout(self.output), redirect_stderr(io.StringIO())):
            stream.__enter__()
            self.addCleanup(stream.__exit__, None, None, None)

    def job(self, role="backup", run=None):
        config = schedule.config_for(SETTINGS / (role + ".example.json"), role)
        args = SimpleNamespace(project="pilot", role=role, env_file=None)
        return schedule.Schedule(args, config, self.root, run or Mock(), RuntimeError)

    def point(self, at):
        return {"capturedAt": at.isoformat(), "point": "fixture", "receiptSha256": "0" * 64}

    def test_production_configuration_has_two_utc_windows_twelve_hours_apart(self):
        settings = schedule.config_for(SETTINGS / "backup.example.json", "backup")
        minutes = settings["backupIntervalMinutes"]
        offset = settings["backupOffsetMinutesUtc"]
        for hour, minute, previous in ((0, 59, -11), (1, 0, 1), (12, 59, 1), (13, 0, 13), (23, 59, 13)):
            with self.subTest(hour=hour, minute=minute):
                current = NOW.replace(hour=hour, minute=minute)
                expected = NOW.replace(hour=0, minute=0) + timedelta(hours=previous)
                self.assertEqual(schedule.slot_at(current, minutes, offset), int(expected.timestamp()))
        self.assertEqual(schedule.slot_at(NOW, minutes, offset) -
                         schedule.slot_at(NOW - timedelta(hours=12), minutes, offset), 43200)

    def test_missed_windows_coalesce_and_completed_slot_is_durable(self):
        run = Mock(side_effect=lambda args, output: output.emit("replica_verified", **self.point(NOW)))
        job = self.job(run=run)
        latest = schedule.slot_at(NOW, 720, 60)
        job.state["backupSlot"] = latest - 3 * 43200
        with patch.object(job, "status", return_value={}), patch.object(offsite, "now_utc", return_value=NOW):
            self.assertTrue(job.backup_due(NOW))
        self.assertEqual(job.state["backupSlot"], latest)
        self.assertIn('"coalescedSlots":2', self.output.getvalue())
        resumed = self.job(run=run)
        self.assertTrue(resumed.backup_due(NOW + timedelta(minutes=2)))
        run.assert_called_once()

    def test_old_pending_copy_cannot_fulfill_a_new_window(self):
        timestamps = iter((NOW - timedelta(hours=1), NOW))
        run = Mock(side_effect=lambda args, output: output.emit("replica_verified", **self.point(next(timestamps))))
        job = self.job(run=run)
        with patch.object(job, "status", return_value={}):
            self.assertTrue(job.backup_due(NOW))
        self.assertEqual(run.call_count, 2)
        self.assertEqual(job.state["backupSlot"], schedule.slot_at(NOW, 720, 60))

    def test_publish_then_local_failure_does_not_repeat_cold_backup(self):
        def publish_then_fail(args, output):
            output.emit("replica_verified", **self.point(NOW))
            raise offsite.OffsiteError("staging cleanup failed")
        run = Mock(side_effect=publish_then_fail)
        job = self.job(run=run)
        with patch.object(job, "status", return_value={}), patch.object(offsite, "now_utc", return_value=NOW):
            self.assertFalse(job.backup_due(NOW))
        self.assertEqual(job.state["alerts"]["backup"]["payload"]["event"], "scheduled_backup_failed")
        self.assertTrue(self.job(run=run).backup_due(NOW + timedelta(minutes=10)))
        run.assert_called_once()

    def test_pending_alert_survives_exit_and_recovery_until_receiver_acknowledges(self):
        job = self.job()
        job.notify("backup", "scheduled_backup_failed", "critical")
        event = job.state["alerts"]["backup"]["payload"]
        with patch.object(schedule, "deliver", side_effect=OSError("temporary receiver failure")) as send:
            self.assertFalse(job.send_alerts())
            send.assert_called_once_with(job.config, event)
        resumed = self.job()
        resumed.resolve("backup")
        with patch.object(schedule, "deliver") as send:
            self.assertTrue(resumed.send_alerts())
            send.assert_called_once_with(resumed.config, event)
        self.assertNotIn("backup", self.job().state["alerts"])

    def test_retention_waits_for_todays_verified_backup_and_runs_once(self):
        job = self.job("retention")
        older = {"level": "ok", **self.point(NOW - timedelta(days=1))}
        with patch.object(job, "store", return_value=(self.root, {})), patch.object(
                offsite, "monitor", side_effect=(older, {"level": "ok", **self.point(NOW)})), patch.object(
                offsite, "prune", return_value={"applied": True, "keep": [], "remove": []}) as prune:
            self.assertTrue(job.retention_due(NOW))
            prune.assert_not_called()
            self.assertTrue(job.retention_due(NOW))
            self.assertTrue(self.job("retention").retention_due(NOW + timedelta(hours=1)))
            prune.assert_called_once_with(self.root, {}, NOW, True)


if __name__ == "__main__":
    unittest.main()
