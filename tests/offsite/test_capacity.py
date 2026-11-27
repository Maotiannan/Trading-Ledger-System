import multiprocessing as mp
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from datetime import timedelta

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts/backup"))
import r2_capacity as c


def contender(path, conn):
    try:
        with c.locked(path):
            conn.send("entered")
    except c.CapacityUnknown as e:
        conn.send(str(e))


class CapacityTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.d = Path(self.tmp.name)
        self.now = c.utc()
        self.policy = {
            "inventory_complete": True,
            "bucket_ids": ["a", "b", "b"],
            "extra_reserved_bytes": 100,
        }
        c.write_private(self.d / "policy.json", self.policy)
        c.publish_sample(self.d, "a", 7_000_000_000, self.now)
        c.publish_sample(self.d, "b", 2_000_000_000, self.now)

    def test_thresholds_dedup_and_modes(self):
        for n, want in [
            (0, "allow"),
            (499_999_900, "warning"),
            (799_999_900, "paused"),
        ]:
            q = c.evaluate(self.d, "a", n, self.now)
            self.assertEqual(
                (q["measured_bytes"], q["extra_reserved_bytes"], q["decision"]),
                (9_000_000_000, 100, want),
            )
        for f in self.d.iterdir():
            self.assertEqual(stat.S_IMODE(f.stat().st_mode), 0o600)

    def test_pending_survives_process_exit(self):
        with c.locked(self.d):
            self.assertEqual(
                c.reserve_upload(self.d, "a", 500_000_000, self.now)["decision"],
                "warning",
            )
            ctx = mp.get_context("spawn")
            pipe, other = ctx.Pipe()
            p = ctx.Process(target=contender, args=(self.d, other))
            p.start()
            self.assertEqual(pipe.recv(), "capacity_check_busy")
            p.join(5)
            self.assertEqual(p.exitcode, 0)
        with c.locked(self.d):
            self.assertEqual(
                c.reserve_upload(self.d, "b", 300_000_000, self.now)["decision"],
                "paused",
            )
            c.publish_sample(self.d, "b", 2_000_000_000, self.now)
            self.assertEqual(
                c.evaluate(self.d, "b", 0, self.now)["pending_bytes"], 500_000_000
            )
            c.publish_sample(self.d, "a", 7_100_000_000, self.now)
            self.assertEqual(c.evaluate(self.d, "b", 0, self.now)["pending_bytes"], 0)

    def test_incomplete_unlisted_stale_and_missing(self):
        c.write_private(
            self.d / "policy.json", {**self.policy, "inventory_complete": False}
        )
        with self.assertRaises(c.CapacityUnknown):
            c.evaluate(self.d, "a", 1, self.now)
        c.write_private(self.d / "policy.json", self.policy)
        c.publish_sample(self.d, "unknown", 1, self.now)
        with self.assertRaises(c.CapacityUnknown):
            c.evaluate(self.d, "a", 1, self.now)
        c.bucket_file(self.d, "unknown", "usage").unlink()
        c.publish_sample(self.d, "b", 1, self.now - timedelta(days=3))
        with self.assertRaises(c.CapacityUnknown):
            c.evaluate(self.d, "a", 1, self.now)
        c.bucket_file(self.d, "b", "usage").unlink()
        with self.assertRaises(c.CapacityUnknown):
            c.evaluate(self.d, "a", 1, self.now)


if __name__ == "__main__":
    unittest.main()
