# MuLedger NAS backup and recovery

## What must survive

Back up the **entire** `trading_ledger` MySQL database and **all of** `UPLOAD_HOST_DIR` as one snapshot. That includes approvals and their decision audits, account and integration state, notification snapshots, and every uploaded or generated document. Application images, builds and logs are not business backups. Deployment credentials must be recovered separately from the site's protected source.

Uploads and snapshots are on the same NAS. This protects against application mistakes, not loss of the NAS. The active job does not upload to COS. See the [historical index](archive/README.md) for earlier drills and feature-specific recovery checks.

## Run and monitor

The maintained entry point is `scripts/backup/run-muledger-local-backup-docker.sh`. Use the mode-600 site environment at `~/.muledger-backup/muledger-backup.env`; the [example](../../scripts/backup/muledger-backup.env.example) documents required variables. Verify that the configured SMB mount is active, the database is the intended MuLedger database, and the upload path matches the running app. Never substitute an empty local directory for an unavailable NAS.

The isolated backup container mounts the checkout and upload source read-only, with only the NAS backup destination writable. The job stages the SQL dump and media archive, verifies both and publishes by rename into `snapshots/YYYY/MM/DD/muledger-YYYYMMDD-HHMMSS/`. A manifest records sizes, hashes and media count. Keep the atomic NAS lock directory empty; do not clear a lock unless the owning job has been proved inactive.

| Command from main | Purpose |
| --- | --- |
| `scripts/backup/check-muledger-local-backup-status.sh` | Reads the local status file, not business records or media. |
| `scripts/backup/run-muledger-local-backup-docker.sh --dry-run` | Checks the configured backup inputs. This is **not** a restore test. |
| `scripts/backup/run-muledger-local-backup-docker.sh --verify "$SNAPSHOT"` | Verifies a complete published snapshot: hashes, streams, safe archive paths, manifest and file count. |
| `scripts/backup/run-muledger-local-backup-docker.sh` | Publishes a real backup; use the existing scheduler unless a manual backup is authorized. |

The macOS LaunchAgent is `com.muledger.local-backup`, normally 02:30 local time, with 30-day retention. Inspect the installed plist and site configuration rather than assuming the checkout or defaults. On an existing site, switch only the command and working directory after checking that no job is active; keep the schedule, environment and logs. The clean-install script also builds a runner and retires an old job: **do not use it for a path-only change**.

## Diagnose the two results

Check `~/.muledger-backup/status.json` and `~/.muledger-backup/logs/launchd.{out,err}.log`.

| Publication | Cleanup | What to do |
| --- | --- | --- |
| Failed, no new snapshot | Not run | Check free space, SMB mount, credentials and source. The runner may retry the full backup (default 3 attempts, 5 minutes apart). |
| Success | Success | Check snapshot freshness (default 36 hours) and retain the last successful time. |
| Success | Deferred | An expired snapshot is busy on SMB. Keep the published snapshot; cleanup retries after a later publication. |
| Success | Failed | The snapshot remains valid. Investigate the reported path/permission or mount error. The watchdog signals failure; **do not repeat the dump and archive for a cleanup error**. |

Retention touches only recognized, expired snapshot names after verified publication. A previously listed, entirely expired date directory that disappears during traversal is harmless **only if the root and new publication are still present**. A missing root, new/retained directory, lost manifest or real access/I/O error is a failure. Unrecognized entries and snapshots in the retention period are not removed. `LOCAL_RETENTION_DAYS=0` disables retention.

## Restore and change gate

1. Verify the selected snapshot. Start a separate database and app with disposable ports, credentials, volumes and upload path. Never restore over production or reuse its external sending, webhooks or integration credentials.
2. Import the dump and extract media **only** into those isolated targets. Compare protected table counts, identifiers and financial relationships; verify representative receipt, payment-detail and SWIFT files against their references and hashes. Check approvals and their corresponding audit decisions, account roles, recovery state, linked source IDs, prepayments, notifications/consents and immutable sent content. Never replay past sends or approve restored requests.
3. Apply any proposed migration **to the restored copy first**. Check before/after counts and key business invariants, then do a dump/restore round trip when schema or storage changes. Record the dataset class, checks, results and omissions without credentials or customer records in Git. Synthetic CI drills (`npm run test:reliability:isolated`) do not prove a particular production snapshot recoverable.
4. Before adding a table, file family, external store, retention policy or scheduler path, check these two backup boundaries and update this runbook and restore checklist. Data outside them requires its own backup and verified recovery path. Keep production recovery/switchover a separate authorized operation.
