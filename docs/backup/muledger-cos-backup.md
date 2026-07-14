# MULEDGER COS Backup Runbook

This runbook is only for the `muledger` project.

## 1. Data Scope

Back up these two business data areas:

- MySQL database: `trading_ledger`
- NAS upload directory: `/Volumes/团队文件-DAINTY_SHIPMENT/docker/trading-ledger-system/upload`

The MySQL dump includes account-level preferences such as `UserPreference.dashboardLayout` and `UserPreference.listPageSizes`, plus Orders workflow data such as `OrderTracker.confirmedAt`. No separate media backup path is required for Dashboard preferences or Orders confirmation dates.

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

Only after a successful drill should production restore be considered.
