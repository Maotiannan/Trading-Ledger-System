# MULEDGER NAS Local Backup Runbook

This runbook is only for the `muledger` project.

## 1. Data Scope

Back up both authoritative business data areas:

- MySQL database: `trading_ledger`
- NAS upload directory: `/Volumes/团队文件-DAINTY_SHIPMENT/docker/trading-ledger-system/upload`

Snapshots are stored under:

`/Volumes/团队文件-DAINTY_SHIPMENT/docker/backups/muledger`

The database dump includes all customers, invoices, financial orders, receipts, payment details, SWIFT records, approvals, audit records, account preferences, Orders workflow data, settings, and external synchronization state. The MU Contract integration tables `ExternalOrderSourceLink`, `IntegrationSyncState`, `IntegrationEventReceipt`, `IntegrationSyncConflict`, and `IntegrationReconcilePreview` are covered automatically by the complete `trading_ledger` dump.

Receipt transfer reversal data is also fully covered by the database dump. This includes `BalanceTransfer.generatedReceiptId`, the linked system-generated Receipt, the real Receipt, source and target Orders, and strict reversal audit records. The feature adds no file family outside `UPLOAD_HOST_DIR`.

Do not back up Docker containers, images, `.next`, `node_modules`, logs, or test output as business data.

### Accepted Limitation

The upload source and snapshots are on the same NAS. This protects against accidental deletion, application mistakes, and failed database migrations, but it does not protect against loss of the entire NAS or all of its disks. This limitation was explicitly accepted when cloud backup was retired on 2026-07-19.

### NAS Upload Layout

The media archive contains the complete `UPLOAD_HOST_DIR`, including:

| Path under `UPLOAD_HOST_DIR` | Current use |
| --- | --- |
| `images/receipts/direct/` | `Create Receipt Directly` attachments |
| `images/receipts/ocr/` | Receipt OCR uploads |
| `images/details/ocr/` | Payment Detail uploads and generated previews |
| `images/swifts/ocr/` | SWIFT images and PDF attachments |
| `images/receipts/generated/` | Finalized signed receipt images |
| `images/receipts/generated/signatures/` | Signed receipt signature artifacts |
| `images/agents/files/` | Payment Agent files |
| `images/customers/files/` | Customer company files |

If code adds a durable file family, keep it under `UPLOAD_HOST_DIR` or document a separate backup and restore source in the same change.

## 2. Snapshot Format

Each successful backup is published atomically as:

```text
/Volumes/团队文件-DAINTY_SHIPMENT/docker/backups/muledger/
  snapshots/YYYY/MM/DD/muledger-YYYYMMDD-HHMMSS/
    database/trading_ledger-YYYYMMDD-HHMMSS.sql.gz
    database/trading_ledger-YYYYMMDD-HHMMSS.sql.gz.sha256
    media/upload-YYYYMMDD-HHMMSS.tar.gz
    media/upload-YYYYMMDD-HHMMSS.tar.gz.sha256
    manifest.json
    manifest.json.sha256
```

The manifest records file names, sizes, SHA-256 values, media file count, Git commit, and creation time. It never records database credentials or application tokens.

The script writes into `.staging`, verifies the complete payload, and then renames it into `snapshots`. A failed run removes only its incomplete staging directory, leaves every published snapshot unchanged, skips retention, and exits non-zero.

## 3. Local Configuration

Create the local mode-600 environment file:

```bash
mkdir -p ~/.muledger-backup
cp scripts/backup/muledger-backup.env.example ~/.muledger-backup/muledger-backup.env
chmod 600 ~/.muledger-backup/muledger-backup.env
```

Required values:

```bash
DATABASE_URL=mysql://muledger:replace-with-your-password@192.168.1.3:3306/trading_ledger
UPLOAD_HOST_DIR=/Volumes/团队文件-DAINTY_SHIPMENT/docker/trading-ledger-system/upload
MULEDGER_LOCAL_BACKUP_ROOT=/Volumes/团队文件-DAINTY_SHIPMENT/docker/backups/muledger
LOCAL_RETENTION_DAYS=30
MULEDGER_BACKUP_MIN_FREE_BYTES=5368709120
MYSQLDUMP_BIN=auto
MYSQLDUMP_DOCKER_IMAGE=mariadb:10.6
```

The script refuses an environment file that is not mode `600`, a database other than `trading_ledger`, overlapping source/backup paths, symbolic links or special files in the media source, insufficient free space, and overlapping backup processes.

## 4. Manual Backup And Verification

Create the NAS root once:

```bash
mkdir -p /Volumes/团队文件-DAINTY_SHIPMENT/docker/backups/muledger
```

Validate without writing:

```bash
scripts/backup/muledger-local-backup.sh --dry-run
```

Create a complete snapshot:

```bash
scripts/backup/muledger-local-backup.sh
```

Find and verify the newest snapshot:

```bash
LATEST_SNAPSHOT="$(
  find /Volumes/团队文件-DAINTY_SHIPMENT/docker/backups/muledger/snapshots \
    -mindepth 4 -maxdepth 4 -type d -name 'muledger-*' | sort | tail -1
)"
test -n "$LATEST_SNAPSHOT"
scripts/backup/muledger-local-backup.sh --verify "$LATEST_SNAPSHOT"
```

Verification checks all SHA-256 files, both gzip streams, archive paths and file types, manifest identity, names, sizes, hashes, and media file count. Verification is read-only and never restores a database.

## 5. Daily Schedule

Install the macOS LaunchAgent:

```bash
scripts/backup/install-muledger-backup-launchd.sh
```

Default schedule: every day at `02:30`.

Active job:

```text
com.muledger.local-backup
```

Logs:

```text
~/.muledger-backup/logs/launchd.out.log
~/.muledger-backup/logs/launchd.err.log
```

The installer unloads and removes only the retired `com.muledger.cos-backup` plist. It does not delete historical logs or backup files.

## 6. Retention And Failure Handling

The default retention period is 30 days. Retention runs only after a new snapshot has passed verification and been atomically published.

Cleanup is constrained to directories matching:

```text
snapshots/YYYY/MM/DD/muledger-YYYYMMDD-HHMMSS
```

Unexpected files and directories are not removed. `LOCAL_RETENTION_DAYS=0` disables automatic retention.

Treat any non-zero LaunchAgent exit as an operational failure. Check the stderr log, preserve the failed-stage evidence, verify the NAS mount and free space, then rerun `--dry-run`. Never delete `.backup.lock` while a backup process is running.

## 7. Restore Principle

Never restore directly over the production database.

Correct restore drill:

1. Run `--verify` against the selected snapshot.
2. Start a new temporary MariaDB 10.6 container without production volumes or networks.
3. Restore the snapshot dump into a new temporary database.
4. Extract media into a new temporary directory.
5. Run Prisma migrations only against the temporary database.
6. Compare protected table counts and row fingerprints.
7. Verify login, customers, invoices, receipts, payment details, SWIFT, Dashboard, Orders, settings, and representative PNG/JPG/PDF files.
8. Remove only the temporary container and temporary extraction directory after evidence is saved.

A production recovery must restore into a new database first and switch only after validation. The backup script intentionally exposes no command that overwrites `trading_ledger`.

## 8. Receipt Transfer Reversal Deployment Gate

Before migration `20260827090000_balance_transfer_generated_receipt` or any live transfer repair:

1. Create and verify a fresh complete NAS snapshot.
2. Restore that exact database dump into disposable MariaDB with no production volume or network reuse.
3. Record counts and deterministic fingerprints for `Order`, `Invoice`, `Receipt`, `BalanceTransfer`, `Detail`, `DetailItem`, and `AuditLog` before migration.
4. Apply the migration only to the restored copy. Confirm the known unique historical transfer links to exactly one Receipt and an intentionally ambiguous fixture remains unlinked.
5. Run isolated API case `69-receipt-transfer-reversal` against a disposable application/database and verify direct ADMIN, SALES approval, stale retry, ambiguity, protected-reference rollback, permissions, and idempotency.
6. Re-run counts/fingerprints and confirm the additive relationship changes no financial values, Receipt ownership, Detail linkage, media paths, or unrelated audit rows.

For the one-time `TRANSFER-1787794481934` repair, the authenticated ADMIN action may run only after the exact pre-deployment snapshot has passed verification and restore rehearsal. Immediately verify all postconditions:

- synthetic Receipt `TRANSFER-1787794481934` is absent;
- its `BalanceTransfer` row is absent;
- real Receipt `0001170` remains unchanged and bound to `SUPER DT2-08B` / `L25MH090002B`;
- target live balance is `10,453`;
- empty incorrect `Super DT2-08 B` / `Un_Associated` source Order is absent;
- one strict reversal audit row records before/after values and the actor.

Do not use Rematch, generic deletion, direct SQL, or a restore over the active database for this repair.

## 9. MU Contract Orders Deployment Gate

Before migration `20260718090000_mu_contract_order_sync` is applied to the active database:

1. Create and verify a current NAS snapshot.
2. Restore that exact dump into a separate MariaDB 10.6 container with no production volume or port reuse.
3. Record pre-migration row counts and fingerprints for `OrderTracker`, `Order`, `Invoice`, `Receipt`, `Detail`, and `Swift`.
4. Run `npx prisma migrate deploy` only against the restored copy.
5. Confirm all five integration tables exist and are empty before first synchronization.
6. Confirm the six protected tables have identical counts and fingerprints before and after migration.
7. Run `npm run test:api:isolated -- --case 95-mu-contract-order-sync`.
8. Save the evidence under `docs/backup/restore-drills/` before production migration.

Do not use Full Reconcile or business Rematch as a migration test. Synchronization stays disabled until the production schema, application, source credential, and ADMIN Full Reconcile preview gates pass.

## 10. Backup Change Gate

Any durable data change must update this runbook in the same work item.

Required checks:

- Confirm new database data is inside the full `trading_ledger` dump.
- Add new upload/generated-file paths to the NAS layout table.
- Document any persistence outside MySQL and `UPLOAD_HOST_DIR` with its own backup and restore commands.
- Run `scripts/backup/muledger-local-backup.sh --dry-run` after backup path or script changes.
- Run a restore drill when dump tooling, database engines, restore assumptions, or critical table families change.

## 11. Historical Cloud Backups

Tencent COS uploads were retired by user decision on 2026-07-19. MULEDGER no longer stores cloud credentials, installs COSCLI, or writes new cloud objects. Existing remote objects were not deleted and remain historical recovery evidence.

The active rollout and historical drills remain valid records of what was tested at that time:

| Date | Backup | Result | Evidence |
| --- | --- | --- | --- |
| 2026-07-19 | Active NAS database/media snapshot and production rollout | `PASS` | [NAS rollout and restore](restore-drills/2026-07-19-muledger-nas-local-backup-rollout.md) |
| 2026-07-18 | Historical cloud database/media backup | `PASS` for MU Contract migration | [Migration drill](restore-drills/2026-07-18-mu-contract-order-sync-migration-drill.md) |
| 2026-07-17 | Historical cloud database/media backup | `PASS_WITH_FINDINGS` | [Full drill](restore-drills/2026-07-17-muledger-cos-restore-drill.md) |

The 2026-07-17 missing receipt-image finding was closed with user approval by clearing only the two unrecoverable current image associations while preserving receipt data and audit records. New NAS snapshots must reflect that corrected current database state.
