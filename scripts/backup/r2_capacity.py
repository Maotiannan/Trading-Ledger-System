"""Host-local, same-account backup admission. All sizes are decimal bytes.

Both uploaders use an exclusive flock on capacity.lock until the upload finishes.
A reservation survives a crash and is cleared only by a subsequent bucket scan
started under this lock. No cloud credentials are exchanged between projects.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import stat
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_WARN = 9_500_000_000
DEFAULT_STOP = 9_800_000_000


class CapacityUnknown(ValueError):
    pass


def utc():
    return datetime.now(timezone.utc)


def integer(value, name):
    if type(value) is not int or value < 0:
        raise CapacityUnknown(name)
    return value


def write_private(path, value):
    with tempfile.NamedTemporaryFile(dir=path.parent, mode="w", delete=False) as stream:
        tmp = Path(stream.name)
        try:
            json.dump(value, stream, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
            os.replace(tmp, path)
        finally:
            tmp.unlink(missing_ok=True)


def read_private(path):
    if path.is_symlink() or not path.is_file() or stat.S_IMODE(path.stat().st_mode) != 0o600:
        raise CapacityUnknown("missing_or_non_private_" + path.name)
    return json.loads(path.read_text())


@contextmanager
def locked(directory):
    directory = Path(directory).expanduser()
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.is_symlink() or stat.S_IMODE(directory.stat().st_mode) != 0o700:
        raise CapacityUnknown("usage_directory_permissions")
    fd = os.open(directory / "capacity.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "r+") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise CapacityUnknown("capacity_check_busy") from exc
        yield directory


def bucket_file(directory, bucket_id, kind):
    digest = hashlib.sha256(bucket_id.encode()).hexdigest()
    return directory / f"{kind}-{digest}.json"


def publish_sample(directory, bucket_id, byte_count, now):
    """Caller holds capacity.lock throughout the full bucket listing."""
    record = {"bucket_id": bucket_id, "bytes": integer(byte_count, "sample_bytes"),
              "sampled_at": now.astimezone(timezone.utc).isoformat()}
    write_private(bucket_file(directory, bucket_id, "usage"), record)
    bucket_file(directory, bucket_id, "reservation").unlink(missing_ok=True)


def evaluate(directory, upload_bucket, estimate, now):
    policy = read_private(directory / "policy.json")
    if policy.get("inventory_complete") is not True:
        raise CapacityUnknown("account_inventory_incomplete")
    buckets = policy.get("bucket_ids")
    if not isinstance(buckets, list) or not all(isinstance(b, str) and b for b in buckets) or upload_bucket not in buckets:
        raise CapacityUnknown("expected_bucket_inventory")
    warn = integer(policy.get("warn_bytes", DEFAULT_WARN), "warn_bytes")
    stop = integer(policy.get("stop_bytes", DEFAULT_STOP), "stop_bytes")
    ttl = integer(policy.get("max_sample_age_seconds", 86400), "max_sample_age_seconds")
    if not 0 < warn < stop or not ttl:
        raise CapacityUnknown("thresholds_or_sample_age")
    reserve = integer(policy.get("extra_reserved_bytes", 0), "extra_reserved_bytes")
    known_samples = {bucket_file(directory, b, "usage") for b in buckets}
    if set(directory.glob("usage-*.json")) - known_samples:
        raise CapacityUnknown("unlisted_sampled_bucket")
    total = pending = 0
    for bucket in sorted(set(buckets)):
        sample = read_private(bucket_file(directory, bucket, "usage"))
        timestamp = datetime.fromisoformat(sample["sampled_at"])
        if timestamp.tzinfo is None or sample["bucket_id"] != bucket or not 0 <= (now - timestamp).total_seconds() <= ttl:
            raise CapacityUnknown("stale_or_invalid_sample")
        total += integer(sample["bytes"], "sample_bytes")
        path = bucket_file(directory, bucket, "reservation")
        if path.exists():
            item = read_private(path)
            if item["bucket_id"] != bucket:
                raise CapacityUnknown("invalid_reservation")
            pending += integer(item["bytes"], "reservation_bytes")
    projected = total + reserve + pending + integer(estimate, "upload_estimate_bytes")
    decision = "paused" if projected >= stop else "warning" if projected >= warn else "allow"
    return {"decision": decision, "measured_bytes": total, "extra_reserved_bytes": reserve,
            "pending_bytes": pending, "estimated_upload_bytes": estimate, "projected_bytes": projected}


def reserve_upload(directory, bucket, estimate, now):
    decision = evaluate(directory, bucket, estimate, now)
    if decision["decision"] != "paused":
        path = bucket_file(directory, bucket, "reservation")
        if path.exists():
            raise CapacityUnknown("upload_bucket_needs_fresh_sample")
        write_private(path, {"bucket_id": bucket, "bytes": estimate, "reserved_at": now.isoformat()})
    return decision
