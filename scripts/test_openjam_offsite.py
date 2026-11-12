import hashlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import openjam_offsite as offsite


NOW = datetime(2026, 6, 15, 16, tzinfo=timezone.utc)  # Monday


class ReplicaTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "replica"
        self.root.mkdir(mode=0o700)
        self.repo = offsite.init_replica(self.root, "pilot")

    def envelope(self, at, suffix=b"initial", source=None):
        """Use synthetic bytes for storage-policy tests; the Docker drill uses real age."""
        manifest_hash = hashlib.sha256(at.isoformat().encode()).hexdigest()
        point = offsite.point_id(at, manifest_hash)
        path = source or self.root / point
        path.mkdir(mode=0o700)
        files = {}
        for name in offsite.FILES:
            ciphertext = b"age-encryption.org/v1\n" + name.encode() + suffix
            (path / (name + ".age")).write_bytes(ciphertext)
            files[name] = {"bytes": len(ciphertext), "plainBytes": 3, "sha256": hashlib.sha256(ciphertext).hexdigest()}
        meta = {"format": offsite.POINT_FORMAT, "repositoryId": self.repo["repositoryId"], "deployment": "pilot",
                "point": point, "capturedAt": at.isoformat(), "manifestSha256": manifest_hash, "files": files}
        (path / offsite.RECEIPT).write_bytes(offsite.encode(meta))
        return point

    def test_copy_replay_is_idempotent_and_conflicting_receipt_cannot_replace_it(self):
        source = self.root.parent / "source"
        point = self.envelope(NOW, source=source)
        first = offsite.publish(self.root, self.repo, source)
        self.assertEqual(offsite.publish(self.root, self.repo, source), first)
        copy = self.root / point / offsite.RECEIPT
        original = copy.read_bytes()
        other = self.root.parent / "other"
        self.assertEqual(self.envelope(NOW, suffix=b"different", source=other), point)
        with self.assertRaisesRegex(offsite.OffsiteError, "trusted record"):
            offsite.publish(self.root, self.repo, other)
        self.assertEqual(copy.read_bytes(), original)

    def test_copy_failure_keeps_no_ready_point_and_can_retry_same_envelope(self):
        source = self.root.parent / "source"
        point = self.envelope(NOW, source=source)
        with patch.object(offsite, "copy_cipher", side_effect=OSError("I/O error")):
            with self.assertRaises(OSError):
                offsite.publish(self.root, self.repo, source)
        self.assertFalse((self.root / point).exists())
        self.assertFalse((self.root / ".incoming").exists())
        offsite.publish(self.root, self.repo, source)
        self.assertTrue((self.root / point / offsite.RECEIPT).is_file())

    def test_age_thresholds_use_capture_not_replica_mtime(self):
        point = self.envelope(NOW)
        for hours, seconds, expected in ((19, 3599, "ok"), (20, 0, "warning"), (24, 0, "critical")):
            with self.subTest(expected=expected):
                state = offsite.monitor(self.root, self.repo, NOW + timedelta(hours=hours, seconds=seconds))
                self.assertEqual(state["point"], point)
                self.assertEqual(state["level"], expected)

    def test_invalid_newer_point_does_not_count_as_fresh_and_blocks_pruning(self):
        old = self.envelope(NOW - timedelta(hours=2))
        new = self.envelope(NOW)
        image = self.root / new / "seaweedfs.tar.age"
        data = image.read_bytes()
        image.write_bytes(data[:-1] + bytes([data[-1] ^ 1]))
        status = offsite.monitor(self.root, self.repo, NOW)
        self.assertEqual((status["point"], status["level"], status["invalidNewerPoints"]), (old, "critical", [new]))
        with self.assertRaisesRegex(offsite.OffsiteError, "will not delete"):
            offsite.prune(self.root, self.repo, NOW, True)
        self.assertTrue((self.root / old).is_dir())

    def test_prune_preview_is_read_only_and_expired_deletion_is_scoped(self):
        first = self.envelope(NOW)
        second = self.envelope(NOW - timedelta(hours=12))
        expired = self.envelope(NOW - timedelta(days=210))
        sentinel = self.root / "unrelated"
        sentinel.write_bytes(b"unrelated")
        plan = offsite.prune(self.root, self.repo, NOW, False)
        self.assertTrue((self.root / expired).exists())
        self.assertEqual(set(plan["keep"]), {first, second})
        self.assertEqual(plan["remove"], [expired])
        self.assertEqual(offsite.prune(self.root, self.repo, NOW, True)["remove"], [expired])
        self.assertEqual(offsite.prune(self.root, self.repo, NOW, True)["remove"], [])
        self.assertEqual(sentinel.read_bytes(), b"unrelated")

    def test_retention_calendar_boundaries_and_deduplication(self):
        points = {
            "today": NOW,
            "today2": NOW.replace(hour=13),
            "today3": NOW.replace(hour=12),
            "yesterday": NOW - timedelta(days=1),
            "old_daily": NOW - timedelta(days=6),
            "old_weekly": NOW - timedelta(days=14),
            "old_weekly2": NOW - timedelta(days=14, hours=1),
            "last_week": NOW - timedelta(days=21),
            "old_month": NOW.replace(month=4),
            "expired_month": NOW.replace(month=3),
        }
        ordered = sorted([(v, k, "") for k, v in points.items()], reverse=True)
        self.assertEqual(offsite.retained(ordered, NOW), {
            "today", "today2", "yesterday", "old_daily", "old_weekly", "last_week", "old_month",
        })

    def test_always_keep_two_latest_even_when_none_are_current(self):
        ordered = [(NOW - timedelta(days=d), str(d), "") for d in (365, 370, 400)]
        self.assertEqual(offsite.retained(ordered, NOW), {"365", "370"})

    def test_repository_id_protects_against_using_a_different_mount(self):
        with self.assertRaisesRegex(offsite.OffsiteError, "does not match"):
            offsite.replica(self.root, "pilot", "incorrect-id")
        with self.assertRaisesRegex(offsite.OffsiteError, "empty replica"):
            offsite.init_replica(self.root, "pilot")

    def test_ciphertext_copy_and_freshness_do_not_follow_symlinks(self):
        at = self.envelope(NOW)
        target = self.root / at / "postgres.dump.age"
        outside = self.root.parent / "outside"
        outside.write_bytes(target.read_bytes())
        target.unlink()
        target.symlink_to(outside)
        self.assertEqual(offsite.monitor(self.root, self.repo, NOW)["level"], "critical")
        self.assertTrue(outside.is_file())


if __name__ == "__main__":
    unittest.main()
