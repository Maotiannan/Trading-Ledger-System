"""List labelled temp containers; --clean only removes exited, mount-free containers owned by this task."""

import argparse
import json
import re
import subprocess

p = argparse.ArgumentParser()
p.add_argument("--task", required=True)
p.add_argument("--clean", action="store_true")
a = p.parse_args()
if not re.fullmatch(r"muledger-offsite-[0-9a-f]{24}", a.task):
    p.error("expected an exact task token, not a project prefix")


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True).strip()


for cid in docker(
    "ps", "-aq", "--filter", "label=muledger.offsite.task=" + a.task
).split():
    c = json.loads(
        docker(
            "inspect",
            "--format",
            '{"id":{{json .Id}},"status":{{json .State.Status}},"labels":{{json .Config.Labels}},"mounts":{{json .Mounts}}}',
            cid,
        )
    )
    eligible = (
        c["status"] == "exited"
        and c["labels"].get("muledger.offsite.task") == a.task
        and not any(m["Type"] != "tmpfs" for m in c["mounts"])
    )
    print(
        json.dumps(
            {
                "id": c["id"][:12],
                "state": c["status"],
                "owner": a.task,
                "eligible": eligible,
            }
        )
    )
    if a.clean and eligible:
        docker("rm", c["id"])
