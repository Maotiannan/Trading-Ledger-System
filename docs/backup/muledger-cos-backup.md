# MULEDGER COS Backup Runbook

This runbook is only for the `muledger` project.

## 1. Data Scope

Back up these two business data areas:

- MySQL database: `trading_ledger`
- NAS upload directory: `/Volumes/团队文件-DAINTY_SHIPMENT/docker/trading-ledger-system/upload`

The MySQL dump includes account-level preferences such as `UserPreference.dashboardLayout` and `UserPreference.listPageSizes`, Orders workflow data such as `OrderTracker.confirmedAt`, and Customer Analytics rules stored in `SystemSetting` under the seven `CUSTOMER_ANALYTICS_*` keys. Customer Analytics rankings are calculated on demand and are not persisted. No separate media backup path is required for Dashboard preferences, Orders confirmation dates, or Customer Analytics.

MU Contract Orders synchronization adds five durable MySQL tables: `ExternalOrderSourceLink`, `IntegrationSyncState`, `IntegrationEventReceipt`, `IntegrationSyncConflict`, and `IntegrationReconcilePreview`. It also adds nullable archive fields to `OrderTracker`. The existing full `mariadb-dump` of `trading_ledger` includes all of these automatically. The integration creates no file, object-storage, or NAS path, so `media/upload/` coverage does not change.

`OrderTracker.confirmedAt` was introduced with a one-time backfill from `updatedAt` for rows already in `Confirmed` status. Future values are maintained by status transitions and are restored with the rest of the `trading_ledger` dump.

Do not treat Docker containers, `.next`, `node_modules`, or test output as business backup data.

### NAS Upload Layout

The backup script syncs the full NAS upload directory to `media/upload/` in COS. These subpaths are business data and must remain covered:

| NAS path under `UPLOAD_HOST_DIR` | Current use |
| --- | --- |
| `images/receipts/direct/` | `Create Receipt Directly` receipt attachments |
| `images/receipts/ocr/` | receipt OCR upload images |
| `images/details/ocr/` | payment detail OCR uploads and generated detail preview/export images |
| `images/swifts/ocr/` | SWIFT OCR images and PDF attachments |
| `images/receipts/generated/` | finalized generated signed receipt images |
| `images/receipts/generated/signatures/` | generated receipt signature artifacts |
| `images/agents/files/` | payment agent attachment files |
| `images/customers/files/` | customer company files uploaded from Customer Management |

If code adds a new `UploadedAssetCategory`, generated report directory, or file upload subpath, add it to this table and confirm it is under `UPLOAD_HOST_DIR`.

### Backup Change Gate

Any change that adds or changes durable business data must update this runbook in the same work item.

Trigger this gate when changing any of these:

- Prisma schema models, indexes, migrations, seed data, counters, audit tables, approval tables, or any MySQL table used by production.
- Upload categories, image/PDF generation paths, NAS paths, COS paths, `UploadedAsset` lifecycle rules, or cleanup jobs.
- New external persistent storage, third-party file APIs, report export storage, generated documents, or scheduled data pipelines.
- Environment variables that decide where data is stored, dumped, synchronized, cleaned, or restored.

Required checks before closing that work item:

- Confirm the new data is inside MySQL `trading_ledger`, the NAS upload directory, or an explicitly documented new backup source.
- If the data is in MySQL only, confirm `mariadb-dump` backup still captures it automatically.
- If the data creates files, add the exact directory/prefix to the NAS layout table in this document.
- If the data lives outside MySQL/NAS, add a new section with backup command, restore command, retention policy, and failure alert plan.
- Run `scripts/backup/muledger-cos-backup.sh --dry-run` after changing backup scripts or storage environment variables.
- Run a restore drill when adding a new database engine, changing dump tooling, changing restore assumptions, or adding a critical new table family.

### MU Contract Order Sync Deployment Gate

The MU Contract integration is a critical new table family. Before applying migration `20260718090000_mu_contract_order_sync` to the active database:

1. Create and verify a current COS database backup.
2. Restore that exact dump into a separate MariaDB 10.6 container with no production volume or port reuse.
3. Record pre-migration row counts and checksums for `OrderTracker`, `Order`, `Invoice`, `Receipt`, `Detail`, and `Swift`.
4. Run `npx prisma migrate deploy` only against the restored copy.
5. Confirm all five integration tables exist, `OrderTracker` financial links are unchanged, and the six protected table counts/checksums still match.
6. Run `npm run test:api:isolated -- --case 95-mu-contract-order-sync`; this uses a disposable database and fake source feed, not production data.
7. Save the evidence under `docs/backup/restore-drills/` before approving the production migration.

Do not use Full Reconcile or the existing business Rematch feature as a database migration test. Full Reconcile is enabled only after the schema and application deployment gates pass.

## 2. Tencent Cloud COS Bucket

- Bucket: `muledger-backup-prod-1318783232`
- Region: `ap-shanghai`
- Endpoint: `cos.ap-shanghai.myqcloud.com`
- Access: private read/write

Recommended console settings:

- Enable bucket versioning after creation.
- Enable server-side encryption with `SSE-COS`.
- Add lifecycle rules after the first successful backup:
  - database dumps: keep daily files hot for 30 days, then move old files to infrequent access or archive according to cost requirements.
  - media files: keep as standard storage first; move old versions to cheaper storage only after restore testing.

## 3. CAM Least-Privilege User

Do not use the Tencent Cloud root account key.

Create a CAM sub-user only for backups, for example:

```text
muledger-cos-backup
```

Attach a custom policy like this:

```json
{
  "version": "2.0",
  "statement": [
    {
      "effect": "allow",
      "action": [
        "name/cos:HeadBucket",
        "name/cos:GetBucket",
        "name/cos:HeadObject",
        "name/cos:GetObject",
        "name/cos:PutObject",
        "name/cos:InitiateMultipartUpload",
        "name/cos:UploadPart",
        "name/cos:CompleteMultipartUpload",
        "name/cos:ListMultipartUploads",
        "name/cos:ListParts",
        "name/cos:AbortMultipartUpload"
      ],
      "resource": [
        "qcs::cos:ap-shanghai:uid/1318783232:muledger-backup-prod-1318783232",
        "qcs::cos:ap-shanghai:uid/1318783232:muledger-backup-prod-1318783232/*"
      ]
    }
  ]
}
```

This policy intentionally does not grant bucket deletion, object deletion, bucket policy management, or access to other buckets.

## 4. Local Secret File

Create a local-only env file:

```bash
mkdir -p ~/.muledger-backup
cp scripts/backup/muledger-backup.env.example ~/.muledger-backup/muledger-backup.env
chmod 600 ~/.muledger-backup/muledger-backup.env
```

Fill these fields in `~/.muledger-backup/muledger-backup.env`:

```bash
COS_SECRET_ID=...
COS_SECRET_KEY=...
DATABASE_URL=mysql://...
```

Never paste the real secret into chat and never commit it to Git.

## 5. Install COSCLI

On macOS:

```bash
scripts/backup/install-coscli-macos.sh
```

If `coscli` is not in `PATH`, add this to the shell profile:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## 6. Manual Backup

Run a plan check without uploading:

```bash
scripts/backup/muledger-cos-backup.sh --dry-run
```

Verify COS access:

```bash
scripts/backup/muledger-cos-backup.sh --check-cos --skip-db --skip-media
```

Run the real backup:

```bash
scripts/backup/muledger-cos-backup.sh --check-cos
```

The script writes:

```text
database/mysql/YYYY/MM/DD/trading_ledger-YYYYMMDD-HHMMSS.sql.gz
database/mysql/YYYY/MM/DD/trading_ledger-YYYYMMDD-HHMMSS.sql.gz.sha256
media/upload/...
manifests/YYYY/MM/DD/muledger-backup-YYYYMMDD-HHMMSS.json
```

## 7. Daily Schedule

Install a macOS LaunchAgent. Default schedule is every day at `02:30`.

```bash
scripts/backup/install-muledger-backup-launchd.sh
```

Logs:

```text
~/.muledger-backup/logs/launchd.out.log
~/.muledger-backup/logs/launchd.err.log
```

## 8. Restore Principle

Do not restore directly into the production database first.

Correct restore drill:

1. Download one database dump and verify `.sha256`.
2. Restore into a temporary MariaDB `10.6` database.
3. Point a test app instance to the temporary database.
4. Sync media files to a temporary folder.
5. Verify login, customers, invoices, receipts, details, SWIFT previews, and generated receipt images.
6. Verify the seven Customer Analytics settings returned by the API. If no `CUSTOMER_ANALYTICS_*` rows are persisted, confirm all seven code defaults are returned instead.
7. Compare active database media references with restored files. A missing active reference is a drill finding even when the source NAS file was already missing before backup.
8. Use an authenticated `SELECT 1` against the final MariaDB server as the readiness check; `mariadb-admin ping` alone can succeed during image initialization before the final root password is active.
9. For a database containing MU Contract synchronization state, verify all five integration tables, the committed cursor, external PI links, open conflict count, and `OrderTracker.archivedAt/archiveReason` values.

Only after a successful drill should production restore be considered.

## 9. Restore Drill History

| Date | Backup | Result | Evidence |
| --- | --- | --- | --- |
| 2026-07-17 | `database/mysql/2026/07/17/trading_ledger-20260717-023005.sql.gz` + `media/upload/` | `PASS_WITH_FINDINGS` | [Full report](restore-drills/2026-07-17-muledger-cos-restore-drill.md) |

The 2026-07-17 drill proved database, application, authentication, Dashboard analytics, and protected media recovery. It also found one active image path missing from both NAS and COS, affecting receipts `0001001` and `0001004`, plus seven `.smbdelete*` backup artifacts. The source image could not be recovered; with explicit user approval, the two current receipt image associations were transactionally cleared on 2026-07-17 while preserving receipt history and before/after audit records. The 02:30 drill backup still contains the old references, so current media coverage must be verified against a database backup created after that cleanup before it is described as complete.

The post-cleanup database backup `database/mysql/2026/07/17/trading_ledger-20260717-170009.sql.gz` passed gzip and SHA-256 validation and a targeted isolated MariaDB 10.6 restore. That restore confirmed both receipt image fields are null, their financial fields are unchanged, the stale current path count is zero, and both audit records exist. This targeted database verification closes the unlink operation but does not replace a future full database-plus-media recovery drill.
