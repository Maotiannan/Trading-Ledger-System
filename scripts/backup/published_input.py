"""Turn a verified NAS publication into bounded-memory, stable restic inputs."""

import gzip
import hashlib
import json
import re
import shutil
import subprocess
import tarfile
from pathlib import Path, PurePosixPath

POINT = re.compile(r"snapshots/(\d{4})/(\d{2})/(\d{2})/muledger-(\d{8}-\d{6})")


def timestamp(point):
    m = POINT.fullmatch(point)
    if not m or "".join(m.group(i) for i in (1, 2, 3)) != m[4][:8]:
        raise ValueError("invalid_publication")
    return m[4]


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def read_source(config, point, work):
    stamp = timestamp(point)
    names = [
        "manifest.json",
        "manifest.json.sha256",
        f"database/trading_ledger-{stamp}.sql.gz",
        f"media/upload-{stamp}.tar.gz",
    ]
    root = Path(config["snapshot_root"])
    if not root.is_absolute():
        raise ValueError("invalid_snapshot_root")
    reader = config.get("reader", "docker")
    if reader == "directory":
        src = (root / point).resolve(strict=True)
        if src != root.resolve(strict=True) / point or any(
            (src / n).resolve(strict=True) != src / n for n in names
        ):
            raise ValueError("unsafe_publication")
    elif reader == "docker":
        # Use the same Docker/NAS view as the publisher, without DB variables or network access.
        src = work / "packed"
        src.mkdir()
        proc = subprocess.Popen(
            [
                "docker",
                "run",
                "--rm",
                "--pull",
                "never",
                "--read-only",
                "--network",
                "none",
                "--cap-drop=ALL",
                "--security-opt=no-new-privileges",
                "--mount",
                f"type=bind,src={root},dst=/snap,readonly",
                "--entrypoint",
                "tar",
                config["reader_image"],
                "-C",
                "/snap/" + point,
                "-cf",
                "-",
                "--",
                *names,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        try:
            seen = set()
            with proc.stdout, tarfile.open(fileobj=proc.stdout, mode="r|") as archive:
                for item in archive:
                    if item.name not in names or item.name in seen or not item.isfile():
                        raise ValueError("unexpected_publication_member")
                    seen.add(item.name)
                    target = src / item.name
                    target.parent.mkdir(exist_ok=True)
                    with archive.extractfile(item) as stream, target.open("xb") as out:
                        shutil.copyfileobj(stream, out, 1024 * 1024)
            if proc.wait() or seen != set(names):
                raise ValueError("incomplete_publication")
        finally:
            if proc.poll() is None:
                proc.terminate()
                proc.wait()
    else:
        raise ValueError("invalid_reader")
    metadata = src / names[0]
    h = digest(metadata)
    if (src / names[1]).read_text().split() != [h, "manifest.json"]:
        raise ValueError("manifest_checksum")
    m = json.loads(metadata.read_bytes())
    if (m.get("formatVersion"), m.get("project"), m.get("databaseName")) != (
        1,
        "muledger",
        "trading_ledger",
    ):
        raise ValueError("manifest_identity")
    target = work / "input"
    target.mkdir()
    files = {}
    for kind, packed, name in zip(
        ("database", "media"), names[2:], ("database.sql", "upload.tar")
    ):
        f = src / packed
        section = m[kind]
        if (
            section["file"] != packed
            or f.stat().st_size != section["sizeBytes"]
            or digest(f) != section["sha256"]
        ):
            raise ValueError("payload_checksum")
        with gzip.open(f, "rb") as data, (target / name).open("xb") as plain:
            shutil.copyfileobj(data, plain, 1024 * 1024)
        files[name] = {
            "bytes": (target / name).stat().st_size,
            "sha256": digest(target / name),
        }
    with tarfile.open(target / "upload.tar", "r:") as tf:
        count = 0
        for item in tf:
            p = PurePosixPath(item.name)
            if (
                p.is_absolute()
                or ".." in p.parts
                or not (item.isfile() or item.isdir())
            ):
                raise ValueError("unsafe_media")
            count += int(item.isfile())
    if count != m["mediaFileCount"]:
        raise ValueError("media_count")
    (target / "recovery.json").write_text(
        json.dumps(
            {
                "format": 1,
                "project": "muledger",
                "point": point,
                "source_manifest_sha256": h,
                "media_files": count,
                "files": files,
            },
            sort_keys=True,
        )
        + "\n"
    )
    return target, h


def verify_restored(target):
    meta = json.loads((target / "recovery.json").read_bytes())
    if (
        meta["format"] != 1
        or meta["project"] != "muledger"
        or set(meta["files"]) != {"database.sql", "upload.tar"}
    ):
        raise ValueError("unknown_recovery_format")
    timestamp(meta["point"])
    for name, record in meta["files"].items():
        p = target / name
        if (
            p.is_symlink()
            or not p.is_file()
            or p.stat().st_size != record["bytes"]
            or digest(p) != record["sha256"]
        ):
            raise ValueError("restored_payload_mismatch")
    with tarfile.open(target / "upload.tar", "r:") as tf:
        n = 0
        for m in tf:
            p = PurePosixPath(m.name)
            if p.is_absolute() or ".." in p.parts or not (m.isfile() or m.isdir()):
                raise ValueError("unsafe_restored_media")
            n += int(m.isfile())
    if n != meta["media_files"]:
        raise ValueError("restored_media_count")
    return {"point": meta["point"], "media_files": n, "verified": True}


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Verify a fresh restic restore, without access to NAS or a database."
    )
    parser.add_argument("target", type=Path)
    print(json.dumps(verify_restored(parser.parse_args().target)))
