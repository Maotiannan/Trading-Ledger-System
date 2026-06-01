# MULEDGER COS Backup Runbook

This runbook is only for the `muledger` project.

## 1. Data Scope

Back up these two business data areas:

- MySQL database: `trading_ledger`
- NAS upload directory: `/Volumes/团队文件-DAINTY_SHIPMENT/docker/trading-ledger-system/upload`

Do not treat Docker containers, `.next`, `node_modules`, or test output as business backup data.

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
2. Restore into a temporary MySQL database.
3. Point a test app instance to the temporary database.
4. Sync media files to a temporary folder.
5. Verify login, customers, invoices, receipts, details, SWIFT previews, and generated receipt images.

Only after a successful drill should production restore be considered.
