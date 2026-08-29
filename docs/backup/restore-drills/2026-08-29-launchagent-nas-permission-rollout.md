# 2026-08-29 LaunchAgent NAS Permission Rollout

## Result

`PASS`

The daily MULEDGER backup LaunchAgent can now publish and verify complete NAS snapshots without granting Full Disk Access to `/bin/bash`.

## Incident Evidence

- Interactive `--dry-run` and full backups succeeded as the logged-in user.
- Docker already had working read/write access to the application upload bind mount.
- `launchctl kickstart -k gui/501/com.muledger.local-backup` consistently failed in the old configuration.
- The old LaunchAgent log ended with `find: .../upload: Operation not permitted` and exit code `1`.
- The failure was isolated to the headless macOS LaunchAgent traversing the SMB volume, not to the NAS account, database, application container, or uploaded files.

## Permission Design

The supported LaunchAgent now starts `run-muledger-local-backup-docker.sh`. It does not traverse the SMB volume on the host. The temporary backup container uses:

- repository mount: read-only
- complete `UPLOAD_HOST_DIR`: read-only
- `MULEDGER_LOCAL_BACKUP_ROOT`: writable
- container root filesystem: read-only
- Linux capabilities: all dropped
- database client: MariaDB `10.6.27`, matching the production major version
- retry policy: three attempts, five minutes between attempts

The database credential is passed through the process environment and is absent from Docker command arguments, manifests, and status output.

## LaunchAgent Verification

The installed job remained `com.muledger.local-backup` on the existing daily `02:30` schedule.

Manual background trigger result:

- LaunchAgent runs: `1`
- LaunchAgent exit code: `0`
- local status: `SUCCESS`
- attempts: `1`
- status freshness check: `HEALTHY`

Published snapshot:

`/Volumes/团队文件-DAINTY_SHIPMENT/docker/backups/muledger/snapshots/2026/08/29/muledger-20260829-173120`

Manifest evidence:

- database: `trading_ledger`
- database archive: `5,212,252` bytes
- media archive: `136,590,292` bytes
- media files: `518`
- upload source label: `/Volumes/团队文件-DAINTY_SHIPMENT/docker/trading-ledger-system/upload`

The published snapshot passed a second independent `--verify` run through the same Docker execution path.

## Isolated Restore Verification

The database dump was restored into a temporary MariaDB 10.6 container with:

- no host ports
- network disabled
- `/var/lib/mysql` on an isolated temporary filesystem
- no production database, Docker volume, application network, or NAS upload mount

Restore results:

- database tables: `34`
- completed Prisma migrations: `27`
- `mariadb-check`: pass
- extracted media files: `518 / 518`

The temporary database container and extracted media directory were removed after validation.

## Data Risk Result

- Production database: read-only consistent dump; no writes
- NAS upload source: read-only
- Existing published snapshots: unchanged except for the already configured retention policy, which only runs after successful publication
- Application containers: not rebuilt or restarted
- Business data loss risk from this rollout: none observed
