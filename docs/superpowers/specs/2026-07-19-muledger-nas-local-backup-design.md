# MULEDGER NAS Local Backup Design

## Goal

Replace the MULEDGER Tencent COS backup path with a NAS-only backup workflow that is simple to operate and directly verifiable before database migrations.

The running application remains local Docker. The authoritative business data remains:

- MySQL database `trading_ledger`
- NAS media directory `/Volumes/团队文件-DAINTY_SHIPMENT/docker/trading-ledger-system/upload`

New backups are written to:

`/Volumes/团队文件-DAINTY_SHIPMENT/docker/backups/muledger`

This protects against accidental deletion, application mistakes, and failed database migrations. Because the source media and backup are on the same NAS, it does not protect against loss of the entire NAS or all of its disks. That limitation is accepted for this deployment.

## Scope

The change will:

- replace `muledger-cos-backup.sh` with a local NAS backup command;
- keep the existing daily `02:30` LaunchAgent schedule;
- create complete database and media snapshots with checksums and a manifest;
- retain successful snapshots for 30 days by default;
- provide a snapshot verification command;
- remove MULEDGER's COS upload configuration and local COS credential files;
- update backup, restore, deployment, and agent-facing documentation.

The change will not:

- delete existing objects from Tencent COS;
- uninstall the machine-wide `coscli` binary, because another project may use it;
- restore over the production database;
- include Docker images, containers, `.next`, `node_modules`, logs, or test output;
- change MULEDGER business behavior or financial data.

## Snapshot Layout

Each successful run is published under a timestamped directory:

```text
<backup-root>/snapshots/YYYY/MM/DD/muledger-YYYYMMDD-HHMMSS/
  database/trading_ledger-YYYYMMDD-HHMMSS.sql.gz
  database/trading_ledger-YYYYMMDD-HHMMSS.sql.gz.sha256
  media/upload-YYYYMMDD-HHMMSS.tar.gz
  media/upload-YYYYMMDD-HHMMSS.tar.gz.sha256
  manifest.json
  manifest.json.sha256
```

The manifest records the project, creation time, Git commit, database name, source media path, database and media archive names, sizes, SHA-256 values, media file count, and backup format version. It never records database credentials or application secrets.

## Backup Flow

1. Load a mode-600 local environment file.
2. Validate that the NAS source and backup root exist and do not overlap.
3. Check available NAS capacity against a configurable minimum.
4. Create a unique staging directory under `<backup-root>/.staging/`.
5. Run a transaction-consistent MariaDB dump including routines, triggers, and events.
6. Compress the complete upload directory into a media archive without following symbolic links.
7. Validate gzip streams and calculate SHA-256 values.
8. Generate and validate the manifest.
9. Atomically rename the staging directory into the dated snapshot path on the same NAS filesystem.
10. Only after publication succeeds, remove snapshots older than the configured retention period.

The script uses a lock directory under the backup root so the scheduled job and a manual run cannot overlap. A failed run removes only its own incomplete staging directory, releases its own lock, keeps every previously published snapshot, skips retention, and exits non-zero with a clear failed stage.

## Configuration

The local environment file remains:

`~/.muledger-backup/muledger-backup.env`

It contains only local backup settings:

- `DATABASE_URL`
- `UPLOAD_HOST_DIR`
- `MULEDGER_LOCAL_BACKUP_ROOT`
- `LOCAL_RETENTION_DAYS`
- `MULEDGER_BACKUP_MIN_FREE_BYTES`
- `MYSQLDUMP_BIN`
- `MYSQLDUMP_DOCKER_IMAGE`

All `COS_*` fields are removed. The generated `~/.muledger-backup/cos.yaml` file is deleted after the first verified NAS snapshot. Existing remote COS objects are retained and no remote delete request is issued.

## Verification And Restore Boundary

`muledger-local-backup.sh --verify <snapshot-directory>` performs read-only validation:

- snapshot path is inside the configured backup root;
- required files are present and are regular files;
- both checksum files pass;
- both gzip archives can be read;
- the manifest matches the actual names, sizes, hashes, and media file count;
- no archive member is absolute, traverses with `..`, or has a non-regular unsafe type.

Database restoration remains isolated:

1. verify a selected snapshot;
2. restore its dump into a new temporary MariaDB 10.6 container without production volumes or networks;
3. run migrations only against that temporary database;
4. compare protected business table counts and fingerprints;
5. remove only the temporary container after evidence is saved.

Production restore must always target a new database first. The backup tool will not expose an option that overwrites `trading_ledger`.

## Retention Safety

The default retention is 30 days and is configurable. Cleanup is constrained to directories matching `snapshots/YYYY/MM/DD/muledger-YYYYMMDD-HHMMSS` beneath the resolved backup root. It rejects an empty root, `/`, the upload source, any parent of the upload source, symbolic-link escapes, and unexpected directory names.

Retention runs only after a new snapshot passes verification and is atomically published. A dry run prints backup and retention plans without creating, modifying, or deleting data.

## Automated Tests

Tests use temporary directories and fake database dump commands. They must first fail against the current COS-only implementation, then pass after implementation. Coverage includes:

- dry run performs no writes;
- a successful run publishes the required layout and checksums;
- verification rejects a modified database dump or media archive;
- source and backup path overlap is rejected;
- failure before publication preserves existing snapshots and skips retention;
- retention removes only expired, correctly named snapshots;
- lock contention prevents overlapping runs;
- no command or manifest leaks database credentials;
- project documentation and LaunchAgent reference only the local backup command.

After unit tests, the rollout must create and verify a real NAS snapshot, restore its database dump to an isolated MariaDB container, apply the MU Contract synchronization migration twice, and confirm all protected financial rows are unchanged before production deployment continues.

## Rollout And Rollback

Rollout order:

1. merge the local-backup implementation and pass CI;
2. install the updated LaunchAgent;
3. run a real NAS backup and verify it;
4. remove local COS credentials;
5. continue the already approved MULEDGER migration and application deployment;
6. keep MU Contract synchronization disabled until Full Reconcile is reviewed.

Rollback of the backup change reinstalls the previous script and LaunchAgent but must not delete any NAS snapshots. Rollback of the application uses the verified pre-migration NAS snapshot and the existing isolated-restore procedure; it never edits or deletes the only production database copy in place.
