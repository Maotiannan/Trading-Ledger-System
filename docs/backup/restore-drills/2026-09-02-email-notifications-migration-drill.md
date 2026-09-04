# 2026-09-02 Email Notifications Migration And Restore Drill

## Result

`PASS`

The latest complete MULEDGER NAS snapshot was verified, restored, migrated, populated with representative email records, dumped, and restored again in disposable MariaDB containers. The running application, production database, Docker volumes, Compose networks, and NAS upload source were not modified.

## Source Snapshot

- Snapshot: `/Volumes/团队文件-DAINTY_SHIPMENT/docker/backups/muledger/snapshots/2026/09/02/muledger-20260902-184703`
- Database SHA-256: `0c8172e2679f9d4fdf820af6534b97deedbe2d181084a5c18ea2e48a65b373ba`
- Media SHA-256: `78df48909cbe2974734fe7aefda5a66fe528a6521bb1a7a0aac7ea10da6d4eb1`
- Snapshot publication verification: passed
- Independent pre-drill verification: passed

The backup job had failed since 2026-08-29 because deleting `owner.json` inside the lock directory left an SMB `.smbdelete*` tombstone. The repaired backup uses `mkdir` on an empty `.backup.lock` directory for mutual exclusion and removes the empty directory with `rmdir`. Backup unit tests passed `19/19`, the new snapshot published successfully, and the scheduled-backup status returned `HEALTHY / SUCCESS`.

One historical 88-byte SMB tombstone remains under `.stale-backup-lock-20260902-184357`. Docker Desktop still holds it open. It is outside the active lock path and does not block backups. It was deliberately left in place rather than restarting Docker while business services were running.

## Isolation

- Drill ID: `muledger-email-final-20260902-190559-57858`
- Database engine: MariaDB `10.6.27`
- Databases: two disposable `trading_ledger` restore databases, one for migration and one for round-trip restore
- Database storage: container `tmpfs`; no Docker volume or host database mount
- Network exposure: randomly assigned `127.0.0.1` host ports only
- Production Compose networks: not attached
- NAS upload directory: not mounted into either database container
- Cleanup: both containers, temporary scripts, dumps, credentials, and extracted files were removed after evidence capture

## Restored Baseline

| Table | Rows |
| --- | ---: |
| `Customer` | 60 |
| `Order` | 167 |
| `Invoice` | 38 |
| `Receipt` | 292 |
| `Detail` | 29 |
| `DetailItem` | 235 |
| `Swift` | 27 |
| `AuditLog` | 330,836 |

Before migration, none of the six email tables existed. The protected-business fingerprint was:

```text
170cd24879df52fcb31a58403eec4dd512f67f38899bc79c28aae40f20b49939
```

## Migration Evidence

The first `prisma migrate deploy` applied exactly:

```text
20260901120000_admin_approved_email_notifications
```

The second run returned no pending migrations. Existing business table counts and the protected-business fingerprint were unchanged. The migration is additive: it adds the optional customer language field and durable email contacts, templates, tasks, deliveries, attempts, and webhook history.

An isolated application check confirmed:

- six default templates, covering payment, shipment, and release in English and French;
- outbound delivery defaults to disabled;
- test mode defaults to enabled.

No real Resend API call was made.

## Round-Trip Restore Evidence

Representative records were created through the migrated schema and included in a second compressed database dump:

| Email table | Rows |
| --- | ---: |
| `CustomerNotificationEmail` | 1 |
| `EmailTemplate` | 6 |
| `EmailNotification` | 1 |
| `EmailDelivery` | 1 |
| `EmailDeliveryAttempt` | 1 |
| `EmailWebhookEvent` | 1 |

The post-migration dump SHA-256 was:

```text
4b5dff113ba2bbf9642fbb997e3fa2ba8d94ea6c51180eac9f4259bba0bc639a
```

Restoring this dump into the second disposable MariaDB instance reproduced every baseline business count and every email-table count. The protected-business fingerprint remained:

```text
170cd24879df52fcb31a58403eec4dd512f67f38899bc79c28aae40f20b49939
```

The media archive restored independently with 525 files:

| Type | Files |
| --- | ---: |
| PNG | 233 |
| JPG | 275 |
| PDF | 16 |
| Other | 1 |

The email feature creates no durable file family outside MySQL and does not alter `UPLOAD_HOST_DIR`.

## Rollback Order

If the email release must be rolled back:

1. Keep outbound email disabled in Settings so no new approval can create a sendable delivery.
2. Stop only `email-delivery-trigger` so no queued delivery is dispatched.
3. Preserve all six email tables and `Customer.notificationLanguage`; they contain recipient, approval, sent-content, attempt, and provider-event audit history.
4. Roll the application image back to the prior verified release.
5. Retain the additive tables until a separate, explicitly approved data-removal migration exists.

Do not drop email tables, restore over the production database, delete delivery history, or remove the full business snapshot as part of an application rollback.

## Data Risk

`checked`

The drill proved that the complete MySQL backup includes all new email records, migration is additive and idempotent, old business records remain unchanged, and a second restore preserves both business and email data. No production resource was used as a restore target.
