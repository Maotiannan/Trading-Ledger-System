#!/usr/bin/env python3
"""Ship an existing MuLedger recovery point. This program never init/prunes a repository."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

from published_input import read_source, timestamp
from r2_capacity import (
    CapacityUnknown,
    locked,
    publish_sample,
    read_private,
    reserve_upload,
    utc,
    write_private,
)

TAG = "muledger-complete"
HOST = "muledger-offsite-v1"


class Failure(Exception):
    pass


class Repository:
    def __init__(self, cfg):
        from boto3 import client
        from botocore.config import Config

        u = urlsplit(cfg["endpoint"])
        valid_site = u.scheme == "https" and re.fullmatch(
            r"[0-9a-f]{32}(?:\.[a-z0-9-]+)?\.r2\.cloudflarestorage\.com",
            u.hostname or "",
        )
        lab = (
            cfg.get("isolated") is True
            and u.scheme == "http"
            and u.hostname == "127.0.0.1"
        )
        if (
            (not valid_site and not lab)
            or u.username
            or u.password
            or u.query
            or u.fragment
            or u.path not in ("", "/")
        ):
            raise Failure("invalid_s3_endpoint")
        bucket = cfg["bucket"]
        if not re.fullmatch(
            r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", bucket
        ) or not re.fullmatch(r"[0-9a-f]{64}", cfg["repository_id"]):
            raise Failure("invalid_repository_identity")
        key_file = Path(cfg["password_file"])
        if (
            not key_file.is_absolute()
            or key_file.is_symlink()
            or not key_file.is_file()
            or key_file.stat().st_mode & 0o777 != 0o600
        ):
            raise Failure("password_file_permissions")
        self.cfg, self.bucket = cfg, bucket
        self.env = {
            k: os.environ[k]
            for k in ("PATH", "HOME", "TMPDIR", "SSL_CERT_FILE")
            if k in os.environ
        }
        self.env.update(
            {
                "RESTIC_REPOSITORY": f"s3:{cfg['endpoint'].rstrip('/')}/{bucket}/muledger-restic-v1",
                "RESTIC_PASSWORD_FILE": str(key_file),
                "AWS_ACCESS_KEY_ID": cfg["access_key_id"],
                "AWS_SECRET_ACCESS_KEY": cfg["secret_access_key"],
                "AWS_DEFAULT_REGION": "auto",
                "AWS_EC2_METADATA_DISABLED": "true",
                "GOMAXPROCS": "2",
            }
        )
        self.s3 = client(
            "s3",
            endpoint_url=cfg["endpoint"],
            region_name="auto",
            aws_access_key_id=cfg["access_key_id"],
            aws_secret_access_key=cfg["secret_access_key"],
            config=Config(
                connect_timeout=8, read_timeout=30, retries={"total_max_attempts": 2}
            ),
        )

    def measure(self):
        try:
            return sum(
                o["Size"]
                for p in self.s3.get_paginator("list_objects_v2").paginate(
                    Bucket=self.bucket
                )
                for o in p.get("Contents", [])
            )
        except Exception as err:
            raise CapacityUnknown("bucket_measurement_unavailable") from err

    def call(self, cmd, *args, cwd=None, readonly=False):
        argv = [
            self.cfg.get("restic_bin", "restic"),
            "--no-cache",
            *(["--no-lock"] if readonly else []),
            cmd,
            *args,
        ]
        run = subprocess.run(
            argv,
            env=self.env,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if run.returncode:
            raise Failure(f"restic_{cmd}_exit_{run.returncode}")
        return run.stdout

    def points(self, point):
        return json.loads(
            self.call(
                "snapshots",
                "--json",
                "--host",
                HOST,
                "--tag",
                TAG + "," + point,
                readonly=True,
            )
        )

    def push(self, shared, point, directory, checksum):
        identity = json.loads(self.call("cat", "config", readonly=True))
        if identity["id"] != self.cfg["repository_id"]:
            raise Failure("wrong_repository")
        point_tag = "point-" + timestamp(point)
        existing = self.points(point_tag)
        hash_tag = "source-" + checksum
        if existing:
            if len(existing) != 1 or hash_tag not in existing[0]["tags"]:
                raise Failure("conflicting_cloud_publication")
            publish_sample(shared, self.bucket, self.measure(), utc())
            return {
                "result": "ALREADY_PRESENT",
                "snapshot": existing[0]["id"],
                "snapshot_time": existing[0]["time"],
            }
        previous = json.loads(
            self.call(
                "snapshots", "--json", "--host", HOST, "--tag", TAG, readonly=True
            )
        )
        args = [
            "--json",
            "--force",
            "--host",
            HOST,
            "--tag",
            point_tag,
            "--tag",
            hash_tag,
        ]
        before = self.measure()
        publish_sample(shared, self.bucket, before, utc())
        preview = json.loads(
            self.call(
                "backup", "--dry-run", *args, ".", cwd=directory, readonly=True
            ).splitlines()[-1]
        )
        packed = preview.get("data_added_packed")
        basis = "restic_dry_run_packed"
        if type(packed) is not int or packed < 0:
            packed = sum(p.stat().st_size for p in directory.iterdir())
            basis = "conservative_all_input_bytes"
        # Indexes, locks, snapshots and pack framing are not all in the packed-data estimate.
        estimate = packed + (packed + 49) // 50 + 16 * 1024**2
        gate = reserve_upload(shared, self.bucket, estimate, utc())
        gate.update(
            {"estimate_basis": basis, "phase": "incremental" if previous else "first"}
        )
        if gate["decision"] == "paused":
            return {"result": "PAUSED_CAPACITY", "capacity": gate}
        summary = json.loads(
            self.call("backup", *args, ".", cwd=directory).splitlines()[-1]
        )
        # A partial/failed backup is never treated as a successful publication on retry.
        self.call("tag", "--add", TAG, summary["snapshot_id"])
        visible = self.points(point_tag)
        if len(visible) != 1 or hash_tag not in visible[0]["tags"]:
            raise Failure("cloud_publication_unconfirmed")
        after = self.measure()
        publish_sample(shared, self.bucket, after, utc())
        return {
            "result": "SUCCESS",
            "snapshot": visible[0]["id"],
            "snapshot_time": visible[0]["time"],
            "observed_bucket_delta_bytes": after - before,
            "capacity": gate,
        }


def safe_reason(err):
    return (
        str(err)
        if isinstance(err, (CapacityUnknown, Failure))
        and re.fullmatch(r"[a-zA-Z0-9_\-.]+", str(err))
        else type(err).__name__
    )


def main(argv=None):
    os.umask(0o077)
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--config", required=True, type=Path)
    sub = p.add_subparsers(dest="action", required=True)
    sub.add_parser("submit").add_argument("point")
    sub.add_parser("retry")
    sub.add_parser("sample")
    sub.add_parser("status")
    a = p.parse_args(argv)
    cfg = read_private(a.config)
    state = Path(cfg["state_dir"]).expanduser()
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    if state.is_symlink() or state.stat().st_mode & 0o777 != 0o700:
        raise Failure("state_directory_permissions")
    queue = state / "pending"
    queue.mkdir(mode=0o700, exist_ok=True)
    status = state / "cloud-status.json"
    if a.action == "status":
        result = read_private(status) if status.exists() else {"result": "NOT_RUN", "last_success": None}
        print(json.dumps({**result, "pending_points": len(list(queue.glob("*.json")))}))
        return 0
    if a.action == "submit":
        stamp = timestamp(a.point)
        write_private(queue / (stamp + ".json"), {"point": a.point})
    with locked(state):
        report = read_private(status) if status.exists() else {"last_success": None}
        if a.action == "sample":
            with locked(cfg["capacity_dir"]) as shared:
                repo = Repository(cfg)
                count = repo.measure()
                publish_sample(shared, repo.bucket, count, utc())
                print(json.dumps({"sampled": True, "bytes": count}))
                return 0
        failed = False
        # The newest publication gets a chance even if an old NAS point is no longer readable.
        for marker in sorted(queue.glob("*.json"), reverse=True):
            point = read_private(marker)["point"]
            try:
                with tempfile.TemporaryDirectory(prefix="prepare-", dir=state) as temp:
                    stage, checksum = read_source(cfg, point, Path(temp))
                    with locked(cfg["capacity_dir"]) as shared:
                        repo = Repository(cfg)
                        outcome = repo.push(shared, point, stage, checksum)
            except Exception as err:
                outcome = {
                    "result": "CAPACITY_UNKNOWN"
                    if isinstance(err, CapacityUnknown)
                    else "FAILED",
                    "reason": safe_reason(err),
                }
            ok = outcome["result"] in ("SUCCESS", "ALREADY_PRESENT")
            report = {
                **outcome,
                "point": point,
                "checked_at": utc().isoformat(),
                "last_success": report.get("last_success"),
                "latest_recovery_point": report.get("latest_recovery_point"),
            }
            if ok:
                ack = {
                    "point": point,
                    "snapshot": outcome["snapshot"],
                    "snapshot_time": outcome["snapshot_time"],
                }
                if (
                    not report["last_success"]
                    or ack["snapshot_time"] >= report["last_success"]["snapshot_time"]
                ):
                    report["last_success"] = ack
                if (
                    not report["latest_recovery_point"]
                    or ack["point"] >= report["latest_recovery_point"]["point"]
                ):
                    report["latest_recovery_point"] = ack
            if outcome.get("capacity", {}).get("decision") == "warning":
                print("WARN: projected shared storage reached the warning threshold", file=sys.stderr)
            if ok:
                receipts = state / "receipts"
                receipts.mkdir(mode=0o700, exist_ok=True)
                saved = receipts / marker.name
                if outcome["result"] == "SUCCESS" or not saved.exists():
                    write_private(saved, report)
                write_private(status, report)
                marker.unlink(missing_ok=True)
            else:
                write_private(marker, {"point": point, "result": outcome["result"], "reason": outcome.get("reason")})
                write_private(status, report)
                failed = True
            print(json.dumps(report))
            if outcome["result"] in ("CAPACITY_UNKNOWN", "PAUSED_CAPACITY"):
                break
        return 1 if failed else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print("Offsite job not completed: " + safe_reason(e), file=sys.stderr)
        sys.exit(1)
