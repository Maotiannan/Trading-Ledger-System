"""Compare two real restic inputs on a disposable loopback S3 server; never use site configuration."""

import argparse
import gzip
import hashlib
import io
import json
import logging
import os
import random
import secrets
import shutil
import subprocess
import tarfile
import tempfile
import time
from pathlib import Path

import boto3
from moto.server import ThreadedMotoServer


def fixtures(root):
    rng = random.Random(73411)
    files = {f"images/file-{i:02}.bin": rng.randbytes(1048576) for i in range(24)}
    for day in (1, 2):
        if day == 2:
            files["images/file-07.bin"] = (
                b"X" * 60000 + files["images/file-07.bin"][60000:]
            )
            files["images/file-25.bin"] = rng.randbytes(524288)
        point = root / f"day{day}"
        point.mkdir()
        with tarfile.open(point / "upload.tar", "w") as archive:
            for name, data in sorted(files.items()):
                entry = tarfile.TarInfo(name)
                entry.size, entry.mtime = len(data), 1735600000
                archive.addfile(entry, io.BytesIO(data))
        (point / "database.sql").write_bytes(
            (b"INSERT INTO fixture VALUES (12345, 'synthetic');\n" * 10000)
            + str(day).encode()
        )
        for file in list(point.iterdir()):
            with (
                gzip.open(point / (file.name + ".gz"), "wb", compresslevel=9) as gz,
                file.open("rb") as inp,
            ):
                shutil.copyfileobj(inp, gz)
        yield point


def client(endpoint):
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name="us-east-1",
        aws_access_key_id="fixture",
        aws_secret_access_key="fixture",
    )


def object_bytes(s3, bucket):
    return sum(
        item["Size"]
        for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket)
        for item in page.get("Contents", [])
    )


def isolated_env(endpoint, bucket, password, home):
    return {
        "PATH": os.environ["PATH"],
        "HOME": str(home),
        "RESTIC_REPOSITORY": f"s3:{endpoint}/{bucket}",
        "RESTIC_PASSWORD_FILE": str(password),
        "AWS_ACCESS_KEY_ID": "fixture",
        "AWS_SECRET_ACCESS_KEY": "fixture",
        "AWS_DEFAULT_REGION": "us-east-1",
        "AWS_EC2_METADATA_DISABLED": "true",
        "GOMAXPROCS": "2",
    }


def run(restic, root, endpoint):
    s3 = client(endpoint)
    password = root / "key"
    password.write_text(secrets.token_hex(32))
    password.chmod(0o600)
    points = list(fixtures(root))
    result = {}
    for mode in ("original-gzip", "stable-streams"):
        s3.create_bucket(Bucket=mode)
        env = isolated_env(endpoint, mode, password, root)

        def call(*args, cwd=root):
            return subprocess.check_output(
                [restic, "--no-cache", *args], cwd=cwd, env=env, text=True
            )

        call("init", "--repository-version", "2")
        last = object_bytes(s3, mode)
        stages = []
        for i, point in enumerate(points, 1):
            stage = root / f"input-{mode}-{i}"
            stage.mkdir()
            for f in point.iterdir():
                if f.name.endswith(".gz") == (mode == "original-gzip"):
                    os.link(f, stage / f.name)
            t = time.monotonic()
            summary = json.loads(
                call(
                    "backup",
                    "--json",
                    "--host",
                    "fixture",
                    "--tag",
                    f"day-{i}",
                    ".",
                    cwd=stage,
                ).splitlines()[-1]
            )
            elapsed = time.monotonic() - t
            total = object_bytes(s3, mode)
            restore = root / f"restore-{mode}-{i}"
            call("restore", summary["snapshot_id"], "--target", str(restore))
            for fname in ("database.sql", "upload.tar"):
                data = (
                    gzip.decompress((restore / (fname + ".gz")).read_bytes())
                    if mode == "original-gzip"
                    else (restore / fname).read_bytes()
                )
                assert (
                    hashlib.sha256(data).digest()
                    == hashlib.sha256((point / fname).read_bytes()).digest()
                )
            stages.append(
                {
                    "point": i,
                    "added_object_bytes": total - last,
                    "total_object_bytes": total,
                    "backup_seconds": round(elapsed, 3),
                    "restored_sql_and_media": True,
                }
            )
            last = total
        result[mode] = stages
    return result


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--restic", required=True)
    args = p.parse_args()
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    server = ThreadedMotoServer(ip_address="127.0.0.1", port=0, verbose=False)
    server.start()
    try:
        with tempfile.TemporaryDirectory(prefix="muledger-input-profile-") as work:
            print(
                json.dumps(
                    run(
                        str(Path(args.restic).resolve()),
                        Path(work),
                        "http://127.0.0.1:" + str(server.get_host_and_port()[1]),
                    ),
                    indent=2,
                )
            )
    finally:
        server.stop()
