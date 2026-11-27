"""Synthetic Git/FS checkout; the Docker case runs only on disposable hosted CI."""

import json
import os
import secrets
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/backup/task-resources.py"
LABEL = "muledger.offsite.task"
MARKER = ".muledger-offsite-task"


class InventoryTest(unittest.TestCase):
    def setUp(self):
        self.task = "muledger-offsite-" + secrets.token_hex(12)
        self.other = "muledger-offsite-" + secrets.token_hex(12)
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        self.repo = self.root / "main"
        self.wt = self.root / "linked checkout"
        self.sibling = self.root / "other checkout"
        self.run_cmd("git", "init", "-q", "-b", "main", self.repo)
        self.run_cmd(
            "git",
            "-C",
            self.repo,
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "-qm",
            "synthetic",
            "--allow-empty",
        )
        for path, branch in [(self.wt, "task"), (self.sibling, "another-task")]:
            self.run_cmd(
                "git", "-C", self.repo, "worktree", "add", "-q", "-b", branch, path
            )
        for path, token in [
            (self.wt, self.task),
            (self.repo, self.task),
            (self.sibling, self.other),
        ]:
            (path / MARKER).write_text(token + "\n")

    def run_cmd(self, *args, **kwargs):
        return subprocess.check_output(args, text=True, **kwargs).strip()

    def inventory(self, *args, **kwargs):
        output = self.run_cmd(sys.executable, SCRIPT, *args, cwd=self.wt, **kwargs)
        return {(r["kind"], r["id"]): r for r in map(json.loads, output.splitlines())}

    def test_registered_worktrees_and_nonrecursive_directories(self):
        # The local test never contacts the host's Docker daemon.
        fake = self.root / "docker"
        fake.write_text(
            '#!/bin/sh\ncase "$1:$2" in ps:-aq|volume:ls) exit 0;; *) exit 91;; esac\n'
        )
        fake.chmod(0o700)
        env = {
            **os.environ,
            "PATH": f"{self.root}:{os.environ['PATH']}",
            "TMPDIR": str(self.root),
        }
        scratch = self.root / "muledger-offsite-roundtrip-fixture"
        scratch.mkdir()
        (scratch / MARKER).write_text(self.task + "\n")
        for name, token in [
            ("out/lab", self.task),
            (".next", self.task),
            (".next-other", self.other),
            ("tmp", None),
        ]:
            path = self.wt / name
            path.mkdir(parents=True)
            if token:
                (path / MARKER).write_text(token + "\n")
        (self.wt / "tmp" / MARKER).symlink_to(self.wt / MARKER)
        (self.wt / "build").symlink_to(self.repo, target_is_directory=True)
        (self.wt / "dist").mkdir()
        args = [
            "--directory",
            "out/lab",
            "--directory",
            "build/nested",
            "--directory",
            self.sibling,
            "--directory",
            scratch,
        ]
        read = self.inventory(*args, env=env)
        self.assertEqual(read["worktree", str(self.wt)]["owner"], self.task)
        for path in (self.repo, self.sibling):
            self.assertIsNone(read["worktree", str(path)]["owner"])
        self.assertEqual(
            read["directory", str(self.wt / "out/lab")]["owner"], self.task
        )
        self.assertEqual(read["directory", str(scratch)]["owner"], self.task)
        self.assertIsNone(read["directory", str(self.sibling)]["owner"])
        self.assertEqual(
            read["directory", str(self.wt / ".next-other")]["owner"], self.other
        )
        for name in (".next", "build", "build/nested", "tmp", "dist"):
            self.assertIsNone(read["directory", str(self.wt / name)]["owner"])
        self.assertTrue(all(not row["eligible"] for row in read.values()))
        self.assertEqual(
            read, self.inventory("--task", self.task, "--clean", *args, env=env)
        )
        self.assertTrue((self.wt / "out/lab" / MARKER).is_file())
        self.assertTrue((self.repo / ".git").is_dir())
        denied = subprocess.run(
            [sys.executable, SCRIPT, "--clean"],
            cwd=self.wt,
            env=env,
            capture_output=True,
            check=False,
        )
        self.assertEqual(denied.returncode, 2)

    @unittest.skipUnless(
        os.getenv("GITHUB_ACTIONS") == "true"
        and os.getenv("RUNNER_ENVIRONMENT") == "github-hosted",
        "Docker fixtures only on disposable hosted CI",
    )
    def test_containers_volumes_and_foreign_protection(self):
        def docker(*args):
            return self.run_cmd("docker", *args)

        def volume(suffix, token=None):
            flags = ["--label", f"{LABEL}={token}"] if token else []
            name = docker("volume", "create", *flags, self.task + "-" + suffix)
            self.addCleanup(docker, "volume", "rm", name)
            return name

        lone = volume("unmounted", self.task)
        shared = volume("shared")
        foreign = volume("foreign", self.other)
        lookalike = volume("name-only")

        def container(token, *flags, live=False):
            cid = docker(
                "run",
                "-d",
                "--label",
                f"{LABEL}={token}",
                "--network",
                "none",
                "--tmpfs",
                "/var/lib/mysql",
                *flags,
                "--entrypoint",
                "/bin/sh",
                "mariadb:11",
                "-c",
                "exec sleep 120" if live else "exit 0",
            )
            if not live:
                docker("wait", cid)
            return cid

        owned = container(self.task)
        self.addCleanup(
            lambda: subprocess.run(
                ["docker", "rm", owned], capture_output=True, check=False
            )
        )
        mounted = container(
            self.task, "-v", f"{shared}:/shared", "-v", f"{foreign}:/foreign"
        )
        self.addCleanup(docker, "rm", mounted)
        other = container(self.other)
        self.addCleanup(docker, "rm", other)
        live = container(self.task, live=True)
        self.addCleanup(docker, "rm", live)
        self.addCleanup(docker, "stop", "-t", "1", live)
        rows = self.inventory("--task", self.task)
        self.assertTrue(rows["container", owned[:12]]["eligible"])
        self.assertFalse(rows["container", mounted[:12]]["eligible"])
        self.assertFalse(rows["container", live[:12]]["eligible"])
        self.assertNotIn(("container", other[:12]), rows)
        self.assertNotIn(("volume", lookalike), rows)
        for name, owner in [(lone, self.task), (shared, None), (foreign, self.other)]:
            self.assertEqual(rows["volume", name]["owner"], owner)
            self.assertFalse(rows["volume", name]["eligible"])
        self.inventory("--task", self.task, "--clean")
        self.assertEqual(docker("ps", "-aq", "--filter", f"id={owned}"), "")
        for cid in (mounted, other):
            self.assertEqual(
                docker("inspect", "-f", "{{.State.Status}}", cid), "exited"
            )
        self.assertEqual(docker("inspect", "-f", "{{.State.Status}}", live), "running")
        for name in (lone, shared, foreign, lookalike):
            self.assertEqual(docker("volume", "inspect", "-f", "{{.Name}}", name), name)


if __name__ == "__main__":
    unittest.main(verbosity=2)
