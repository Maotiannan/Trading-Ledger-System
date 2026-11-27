"""Inventory task resources without walking other checkouts or reading volume contents."""

import argparse
import json
import os
import re
import stat
import subprocess
from pathlib import Path

TOKEN = re.compile(r"muledger-offsite-[0-9a-f]{24}")
LABEL = "muledger.offsite.task"
MARKER = ".muledger-offsite-task"
BUILD_DIRS = {
    "out",
    "tmp",
    "build",
    "dist",
    "coverage",
    "node_modules",
    ".swc",
    ".ruff_cache",
    "playwright-report",
    "test-results",
}


def run(*args):
    return os.fsdecode(subprocess.check_output(args)).rstrip("\n")


def token(value):
    return value if isinstance(value, str) and TOKEN.fullmatch(value) else None


def marker(path):
    file = path / MARKER
    try:
        info = file.lstat()
    except FileNotFoundError:
        return None
    if stat.S_ISREG(info.st_mode) and info.st_size < 80:
        return token(file.read_bytes().decode("ascii", errors="replace").strip())


def row(kind, identity, state, owner=None, eligible=False, **details):
    return dict(
        kind=kind,
        id=str(identity),
        state=state,
        owner=owner,
        eligible=eligible,
        **details,
    )


def candidate(name):
    return name in BUILD_DIRS or name == ".next" or name.startswith(".next-")


def directory(path, root, scratch, private_checkout, registered):
    # Only inspect an explicitly named temp root or a known output under this checkout.
    if root in path.parents:
        base = root
        parts = path.relative_to(base).parts
        permitted = private_checkout and candidate(parts[0])
    else:
        base = scratch
        parts = (path.name,)
        permitted = path.parent == scratch and path.name.startswith(
            ("muledger-offsite-", "muledger-input-profile-")
        )
    if not permitted or ".." in parts or ".next" in parts or path in registered:
        return row("directory", path, "protected")
    current = base
    for part in parts:
        current = current / part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            return row("directory", path, "missing")
        if not stat.S_ISDIR(mode):  # Includes symlinks; do not inspect their targets.
            return row("directory", path, "not-a-real-directory")
        if current in registered:
            return row("directory", path, "protected")
    owner = marker(path)
    return row("directory", path, "marked" if owner else "unconfirmed", owner)


def checkout_inventory(extra):
    root = Path(run("git", "rev-parse", "--show-toplevel"))
    entries = (
        run("git", "worktree", "list", "--porcelain", "-z").rstrip("\0").split("\0\0")
    )
    rows, registered = [], set()
    private_checkout = False
    current_owner = None
    for index, entry in enumerate(entries):
        fields = dict(item.split(" ", 1) for item in entry.split("\0") if " " in item)
        path = Path(fields["worktree"])
        branch = fields.get("branch", "").removeprefix("refs/heads/")
        registered.add(path)
        current = path == root
        if current:
            private_checkout = index != 0 and branch not in ("", "main", "master")
            current_owner = marker(path) if private_checkout else None
        rows.append(
            row(
                "worktree",
                path,
                "current" if current else "other-checkout",
                current_owner if current else None,
                branch=branch,
            )
        )
    paths = {p for p in root.iterdir() if candidate(p.name)}
    paths.update(root / p for p in extra)
    # Do not use tempfile.gettempdir(): its writability probe creates a file.
    tmp = Path(os.environ.get("TMPDIR") or "/tmp")
    scratch = tmp.resolve()
    for path in sorted(paths):
        if tmp != scratch and tmp in path.parents:
            path = scratch / path.relative_to(tmp)
        rows.append(directory(path, root, scratch, private_checkout, registered))
    return rows, current_owner


def docker_inventory(task):
    label_filter = "label=" + LABEL + ("=" + task if task else "")
    volumes = set(
        run("docker", "volume", "ls", "-q", "--filter", label_filter).splitlines()
    )
    for cid in run("docker", "ps", "-aq", "--filter", label_filter).splitlines():
        data = json.loads(
            run(
                "docker",
                "inspect",
                "--format",
                '{"id":{{json .Id}},"status":{{json .State.Status}},"owner":{{json (index .Config.Labels "muledger.offsite.task")}},"mounts":{{json .Mounts}}}',
                cid,
            )
        )
        mounts = data["mounts"] or []
        owner = token(data["owner"])
        eligible = bool(
            task
            and owner == task
            and data["status"] == "exited"
            and all(m["Type"] == "tmpfs" for m in mounts)
        )
        volumes.update(m["Name"] for m in mounts if m["Type"] == "volume")
        yield row(
            "container",
            data["id"][:12],
            data["status"],
            owner,
            eligible,
            docker_id=data["id"],
        )
    for name in sorted(volumes):
        owner = token(
            run(
                "docker",
                "volume",
                "inspect",
                "--format",
                '{{with .Labels}}{{index . "muledger.offsite.task"}}{{end}}',
                name,
            )
        )
        # A mount is evidence of a reference, not ownership or exclusive use.
        yield row("volume", name, "labelled" if owner else "unconfirmed", owner)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--task", help="exact task token recorded at creation")
    p.add_argument(
        "--directory",
        action="append",
        default=[],
        help="also inspect a specific temp/build path",
    )
    p.add_argument(
        "--clean", action="store_true", help="only remove eligible exited containers"
    )
    a = p.parse_args()
    if (a.task is not None and not token(a.task)) or (a.clean and not a.task):
        p.error("expected an explicit exact task token, not a project prefix")
    rows, current_owner = checkout_inventory(a.directory)
    rows.extend(docker_inventory(a.task or current_owner))
    for r in rows:
        print(json.dumps(r))
    if a.clean:
        for r in rows:
            if r["kind"] == "container" and r["eligible"]:
                # ID only; never force or remove volumes.
                run("docker", "rm", r["docker_id"])


if __name__ == "__main__":
    main()
