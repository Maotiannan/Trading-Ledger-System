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

Retention lists names first, without asking SMB to stat every entry. It skips whole local-calendar years, months or days newer than the cutoff **before opening them**. On the cutoff day both the existing name/date and age checks still apply. It never follows directory symlinks or removes unrecognized entries. `LOCAL_RETENTION_DAYS=0` disables retention.

A previously listed, entirely expired date branch may disappear only if the backup root and current publication still pass their checks. Losing either of those, the cutoff branch being scanned, or the published manifest is an error, as are access and I/O failures on the necessary paths. Busy expired entries are deferred, not reported as cleaned. A successful cleanup is **not** an inventory or restore test of the retained backups. If a historical publication appears missing, compare its directory and manifest from the scheduled runner's read-only mount with the host view, then investigate any discrepancy separately.

## Restore and change gate

1. Verify the selected snapshot. Start a separate database and app with disposable ports, credentials, volumes and upload path. Never restore over production or reuse its external sending, webhooks or integration credentials.
2. Import the dump and extract media **only** into those isolated targets. Compare protected table counts, identifiers and financial relationships; verify representative receipt, payment-detail and SWIFT files against their references and hashes. Check approvals and their corresponding audit decisions, account roles, recovery state, linked source IDs, prepayments, notifications/consents and immutable sent content. Never replay past sends or approve restored requests.
3. Apply any proposed migration **to the restored copy first**. Check before/after counts and key business invariants, then do a dump/restore round trip when schema or storage changes. Record the dataset class, checks, results and omissions without credentials or customer records in Git. Synthetic CI drills (`npm run test:reliability:isolated`) do not prove a particular production snapshot recoverable.
4. Before adding a table, file family, external store, retention policy or scheduler path, check these two backup boundaries and update this runbook and restore checklist. Data outside them requires its own backup and verified recovery path. Keep production recovery/switchover a separate authorized operation.

## Optional encrypted offsite copy (separate activation)

**Not enabled by a code release.** The existing 02:30 job still publishes/retains 30 days locally. The optional handoff accepts its verified publication marker after local status has been finalized, including when cleanup failed. It does not repeat the SQL dump. The cloud process does not inherit database credentials. Its default reader uses a networkless container, the publisher's NAS bind source read-only and only the named manifest/checksum and two payloads. Missing publications are errors, not empty backups. Unset the handoff to disable cloud sending; do not disable local backups.

Provision privately, after operator approval: host Python 3.11+ with boto3, restic (tested 0.20.0), sufficient temporary disk for packed + decompressed streams, private 0700 state/capacity directories. Use a dedicated private R2 backup bucket with bucket-scoped credentials, **not** the online business bucket. Initialization, cost, credential installation and scheduler activation are separate approvals. Never upload data to test capacity, and never initialize from the daily job.

- In the mode-0600 local backup env set **only** `MULEDGER_OFFSITE_CONFIG` and `MULEDGER_OFFSITE_PYTHON` as private paths. The former is mode-0600 JSON containing `endpoint`, `bucket`, `repository_id` (pin the separately initialized repository), `access_key_id`, `secret_access_key`, `password_file` (absolute, 0600), `snapshot_root`, `reader_image`, `state_dir`, `capacity_dir`, optionally `restic_bin` and `reader_user` (the actual publisher UID:GID for a private Linux bind; otherwise keep the scheduled runner identity). Keep the recovery password and replacement credential process separately from the NAS, state directory and S3 account. Do not commit values. The repository prefix is `muledger-restic-v1`; production requires an HTTPS R2 endpoint.
- The two stable inputs are `database.sql` and `upload.tar`. The reader checks the published manifest and original packed hashes, streams decompression to a private temporary directory, then verifies media paths/types/counts. Restic stores both inputs and `recovery.json` in one encrypted recovery point. The marker and source manifest hash are bound to the point. Only complete successful backups are tagged. Failure preserves the local NAS publication, queue and prior cloud success. Temp data is removed on normal exits.
- Use `muledger_offsite.py --config PRIVATE status` for the independent cloud result, latest recovery point and last successful snapshot/time. `sample` publishes **only this project's** current bucket measurement. `retry` processes queued points without dumping SQL; `submit snapshots/YYYY/MM/DD/muledger-YYYYMMDD-HHMMSS` can enqueue a verified retained point if the host was unavailable before handoff. Duplicate successful points are recognized remotely. Never claim a missing expired local point was transferred.
- The private shared directory uses the cross-project `capacity.lock` (same-host POSIX flock), `policy.json`, `usage-<sha256(bucket ID)>.json` and `reservation-<sha256(bucket ID)>.json`. Private files are atomically replaced at 0600. Bucket IDs are **actual bucket names in the one configured account**, not aliases or prefixes. Policy keys: `bucket_ids`, `inventory_complete`, `max_sample_age_seconds`, `extra_reserved_bytes`, `warn_bytes` (9500000000) and `stop_bytes` (9800000000). Samples contain `bucket_id`, decimal `bytes`, UTC `sampled_at`; no keys or object names. Require a confirmed inventory and fresh samples for every bucket. Unknown/unlisted, missing/stale, read errors and a busy uploader block new backups, not the online bucket. Shared extra reserve is added once after deduplication. Pending upload reservations survive a crash; only the next actual measurement by the bucket owner clears them.
- Measurements are a whole-bucket paginated `ListObjectsV2` sum of current visible object payload lengths, **not** a Cloudflare invoice, an account enumeration, or a guarantee about pending multipart/object metadata. Keep inventory and extra reserve appropriate for other writers and these gaps. A fresh Restic v2 dry-run estimates incremental packed data against the actual index. Add 2% + 16 MiB per new upload for pack/index/lock overhead; older tools without that metric use full input bytes + overhead. This is an estimate, not a hard provider quota. The job holds the shared lock across decision, upload and remeasurement. Report actual pre/post object-byte delta separately; the first run has no historical increment. Do not credit theoretical dedup/prune savings, shorten retention or delete the last successful point to pass the gate. This feature does not run cloud prune. Confirm normal site retention separately before activation.
- Recovery: on an **independent** machine/container with only the S3 repository and escrowed password/credentials, list complete snapshots (`restic --no-cache snapshots --tag muledger-complete`), run `restic --no-cache check --read-data`, restore the exact ID into an empty private directory, then `python3 scripts/backup/published_input.py RESTORED_DIRECTORY`. Import SQL and extract the verified tar only into an isolated empty DB and directory; apply the financial/media checks above. Do not start external triggers. Passing synthetic S3-compatible CI does not prove an actual R2 restore. The existing natural local backup acceptance is separate.
