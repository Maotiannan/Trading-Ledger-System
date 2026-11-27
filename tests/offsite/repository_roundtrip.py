"""Local test: encrypted S3 API, independent copy/key, backlog and capacity. --database: hosted isolated SQL drill."""

import argparse
import hashlib
import json
import logging
import multiprocessing as mp
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time

from input_comparison import client, isolated_env, object_bytes
from drill_ledger import Database

BASE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BASE / "scripts/backup"))
import r2_capacity as cap
from published_input import verify_restored


def serve(pipe):
    from moto.server import ThreadedMotoServer

    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    s = ThreadedMotoServer(ip_address="127.0.0.1", port=0, verbose=False)
    s.start()
    pipe.send("http://127.0.0.1:" + str(s.get_host_and_port()[1]))
    try:
        pipe.recv()
    finally:
        s.stop()


class Store:
    def __init__(self):
        ctx = mp.get_context("spawn")
        self.pipe, other = ctx.Pipe()
        self.p = ctx.Process(target=serve, args=(other,), daemon=True)
        self.p.start()
        self.url = self.pipe.recv()
        self.client = client(self.url)

    def close(self):
        if self.p.is_alive():
            self.pipe.send("stop")
            self.p.join(5)
        if self.p.is_alive():
            self.p.terminate()
            self.p.join()


def check(restic, root, full):
    os.umask(0o077)
    task = "muledger-offsite-" + secrets.token_hex(12)
    (root / ".muledger-offsite-task").write_text(task + "\n")
    print(f"Drill inventory: --task {task} --directory {root}", file=sys.stderr)
    src = root / "capture"
    src.mkdir()
    rescue = root / "recovery"
    rescue.mkdir()
    nas = src / "nas"
    nas.mkdir()
    upload = src / "upload"
    (upload / "images").mkdir(parents=True)
    for name in ("receipt", "detail", "swift", "unlinked"):
        (upload / "images" / (name + ".bin")).write_bytes(secrets.token_bytes(32000))
    cloud, copy = Store(), Store()
    databases = []
    try:
        orig = Database(task) if full else None
        if orig:
            databases.append(orig)
            orig.prepare()
        bucket = "ledger-fixture"
        other = "offline-copy-fixture"
        cloud.client.create_bucket(Bucket=bucket)
        copy.client.create_bucket(Bucket=other)
        pw = src / "restic-key"
        pw.write_text(secrets.token_hex(32))
        pw.chmod(0o600)
        env = isolated_env(cloud.url, bucket + "/muledger-restic-v1", pw, src)

        def rest(e, *args):
            return subprocess.check_output(
                [restic, "--no-cache", *args], env=e, text=True
            )

        rest(env, "init", "--repository-version", "2")
        cfg = {
            "isolated": True,
            "endpoint": cloud.url,
            "bucket": bucket,
            "repository_id": json.loads(rest(env, "cat", "config"))["id"],
            "password_file": str(pw),
            "access_key_id": "fixture",
            "secret_access_key": "fixture",
            "reader": "docker" if full else "directory",
            "reader_image": "mariadb:11",
            "reader_user": f"{os.getuid()}:{os.getgid()}",
            "snapshot_root": str(nas),
            "state_dir": str(src / "state"),
            "capacity_dir": str(src / "capacity"),
            "restic_bin": restic,
        }
        cfgpath = src / "offsite.json"
        cap.write_private(cfgpath, cfg)
        policy = {
            "inventory_complete": True,
            "bucket_ids": [bucket, "second-fixture", "second-fixture"],
            "extra_reserved_bytes": 3100,
        }
        shared = Path(cfg["capacity_dir"])
        with cap.locked(shared):
            cap.write_private(shared / "policy.json", policy)
            cap.publish_sample(shared, "second-fixture", 7300, cap.utc())
        cli = [
            sys.executable,
            str(BASE / "scripts/backup/muledger_offsite.py"),
            "--config",
            str(cfgpath),
        ]

        def job(*args, ok=True):
            run = subprocess.run(cli + list(args), text=True, capture_output=True)
            if (run.returncode == 0) != ok:
                raise AssertionError((run.returncode, run.stdout, run.stderr))
            return json.loads((src / "state/cloud-status.json").read_bytes())

        wrapper = src / "dump"
        dbfile = src / "fixture.sql"
        dbfile.write_text("SELECT 1;\n")
        wrapper.write_text(
            "#!/bin/sh\nexec "
            + (
                "docker exec "
                + orig.cid
                + " mariadb-dump -uroot --single-transaction --routines --events --triggers trading_ledger"
                if orig
                else 'cat "$SYNTHETIC_SQL"'
            )
            + "\n"
        )
        wrapper.chmod(0o700)
        local = {
            "HOME": str(src),
            "PATH": os.environ["PATH"],
            "DATABASE_URL": "mysql://fixture@127.0.0.1:1/trading_ledger",
            "UPLOAD_HOST_DIR": str(upload),
            "MULEDGER_LOCAL_BACKUP_ROOT": str(nas),
            "MYSQLDUMP_BIN": str(wrapper),
            "SYNTHETIC_SQL": str(dbfile),
            "LOCAL_RETENTION_DAYS": "30",
            "MULEDGER_BACKUP_MIN_FREE_BYTES": "0",
        }

        def publication():
            out = subprocess.check_output(
                ["bash", str(BASE / "scripts/backup/muledger-local-backup.sh")],
                env=local,
                text=True,
                stderr=subprocess.DEVNULL,
            )
            return next(
                l.split("=", 1)[1]
                for l in out.splitlines()
                if l.startswith("PUBLISHED_SNAPSHOT=")
            )

        points = []
        witnesses = []
        hashes = []
        ids = []
        for day in (1, 2):
            if day == 2:
                time.sleep(1.05)
                (upload / "images/second.bin").write_bytes(secrets.token_bytes(12000))
                (upload / "images/detail.bin").write_bytes(secrets.token_bytes(18000))
                dbfile.write_text("SELECT 2;\n")
                if orig:
                    orig.second()
            point = publication()
            if full and day == 1:
                manifest = "/snap/" + point + "/manifest.json"
                args = [
                    "docker",
                    "run",
                    "--rm",
                    "--label",
                    "muledger.offsite.task=" + task,
                    "--network",
                    "none",
                    "--read-only",
                    "--cap-drop=ALL",
                    "--mount",
                    f"type=bind,src={nas},dst=/snap,readonly",
                    "--entrypoint",
                    "/bin/sh",
                ]

                def may_read(user):
                    return (
                        subprocess.run(
                            args
                            + [
                                "--user",
                                user,
                                "mariadb:11",
                                "-c",
                                'test -r "$1"',
                                "probe",
                                manifest,
                            ]
                        ).returncode
                        == 0
                    )

                assert not may_read("65534:65534") and may_read(cfg["reader_user"])

            points.append(point)
            witnesses.append(orig.witness() if orig else None)
            hashes.append(
                {
                    p.relative_to(upload).as_posix(): hashlib.sha256(
                        p.read_bytes()
                    ).hexdigest()
                    for p in upload.rglob("*")
                    if p.is_file()
                }
            )
            if day == 2:
                before = object_bytes(cloud.client, bucket)
                cap.write_private(
                    shared / "policy.json",
                    {**policy, "warn_bytes": 9900, "stop_bytes": 10000},
                )
                paused = job("submit", point, ok=False)
                assert (
                    paused["result"] == "PAUSED_CAPACITY"
                    and paused["last_success"]["snapshot"] == ids[0]
                )
                assert (
                    paused["capacity"]["extra_reserved_bytes"] == 3100
                    and paused["capacity"]["measured_bytes"] == 7300 + before
                )
                assert object_bytes(cloud.client, bucket) == before
                subprocess.run(
                    [
                        "bash",
                        str(BASE / "scripts/backup/muledger-local-backup.sh"),
                        "--verify",
                        str(nas / point),
                    ],
                    env=local,
                    check=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                cap.write_private(shared / "policy.json", policy)
                sent = job("retry")
            else:
                sent = job("submit", point)
            assert sent["result"] == "SUCCESS" and sent["capacity"]["phase"] == (
                "first" if day == 1 else "incremental"
            )
            ids.append(sent["snapshot"])
            size = object_bytes(cloud.client, bucket)
            same = job("submit", point)
            assert (
                same["result"] == "ALREADY_PRESENT"
                and same["snapshot"] == ids[-1]
                and object_bytes(cloud.client, bucket) == size
            )
        assert len(json.loads(rest(env, "snapshots", "--json"))) == 2
        # Copy the encrypted repository to a physically separate server (different process/backend).
        for page in cloud.client.get_paginator("list_objects_v2").paginate(
            Bucket=bucket
        ):
            for obj in page.get("Contents", []):
                k = obj["Key"]
                data = cloud.client.get_object(Bucket=bucket, Key=k)["Body"].read()
                copy.client.put_object(Bucket=other, Key=k, Body=data)
        key = rescue / "recovery-key"
        shutil.copyfile(pw, key)
        key.chmod(0o600)
        if orig:
            orig.close()
        cloud.close()
        shutil.rmtree(src)
        recovery = isolated_env(copy.url, other + "/muledger-restic-v1", key, rescue)
        rest(recovery, "check", "--read-data")
        remote = json.loads(rest(recovery, "snapshots", "--json"))
        assert sorted(r["id"] for r in remote) == sorted(ids)
        for i, point in enumerate(points):
            # Resolve the point from remote tags, not a local status file.
            snap = next(
                r
                for r in remote
                if "point-" + point.rsplit("-", 2)[-2] + "-" + point.rsplit("-", 2)[-1]
                in r["tags"]
            )
            target = rescue / str(i)
            rest(recovery, "restore", snap["id"], "--target", str(target))
            assert verify_restored(target)["verified"]
            meta = json.loads((target / "recovery.json").read_bytes())
            assert meta["point"] == point and meta["media_files"] == len(hashes[i])
            for n, data in meta["files"].items():
                with (target / n).open("rb") as f:
                    assert (
                        hashlib.file_digest(f, "sha256").hexdigest() == data["sha256"]
                    )
            with tarfile.open(target / "upload.tar") as tar:
                actual = {
                    str(Path(m.name)): hashlib.sha256(
                        tar.extractfile(m).read()
                    ).hexdigest()
                    for m in tar
                    if m.isfile()
                }
            assert actual == hashes[i]
            if full:
                restored = Database(task)
                databases.append(restored)
                restored.sql((target / "database.sql").read_text())
                w = restored.witness()
                assert w == witnesses[i]
                assert all(ref.removeprefix("/upload/") in actual for ref in w["refs"])
                restored.close()
        return {
            "s3": "two independent loopback S3 API processes, no R2 connection",
            "points": len(remote),
            "media_files": [len(h) for h in hashes],
            "all_hashes_equal": True,
            "pause_local_verified": True,
            "repeat_no_cloud_growth": True,
            "real_database": full,
            "tables_compared": len(witnesses[0]["table_counts"]) if full else None,
            "financial_amounts": [w["money"] for w in witnesses] if full else None,
        }
    finally:
        for db in databases:
            db.close()
        cloud.close()
        copy.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--restic", required=True)
    p.add_argument("--database", action="store_true")
    args = p.parse_args()
    with tempfile.TemporaryDirectory(prefix="muledger-offsite-roundtrip-") as tmp:
        print(
            json.dumps(
                check(str(Path(args.restic).resolve()), Path(tmp), args.database),
                indent=2,
            )
        )
