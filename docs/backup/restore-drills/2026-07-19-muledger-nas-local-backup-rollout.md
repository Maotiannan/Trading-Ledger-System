# 2026-07-19 MULEDGER NAS Backup And MU Contract Sync Rollout

## Result

`PASS`

MULEDGER now creates verified database-and-media snapshots on the NAS only. The MU Contract Orders integration was migrated, deployed, reconciled, and enabled without changing the five financial tables.

## Approved Scope

- Active backup destination: `/Volumes/团队文件-DAINTY_SHIPMENT/docker/backups/muledger`
- Schedule: daily at `02:30`
- Retention: 30 days, applied only after a newly published snapshot passes verification
- Protected data: complete MySQL `trading_ledger` dump and complete `UPLOAD_HOST_DIR` media archive
- Tencent COS: no new uploads; local COS credentials and active `COS_*` settings were removed
- Historical remote COS objects: retained and not modified
- Accepted limitation: the live uploads and snapshots are on the same NAS, so this does not protect against loss of the entire NAS

## Repository And CI

- Release version: `1.0.210`
- Backup rollout PR: `#22`
- Merge commit: `1b5d795`
- PR checks: passed
- post-merge `main` checks: passed

## Pre-Deployment Snapshot

Snapshot:

`/Volumes/团队文件-DAINTY_SHIPMENT/docker/backups/muledger/snapshots/2026/07/19/muledger-20260719-181820`

- Database SHA-256: `ca34d10d9eae91c9c73dec20f75ef1f1dd0f0ec8fd01dbd5f1fef23f95d53f26`
- Media SHA-256: `737c1debc09cfcf8cbb2f24c7d81d766867e0884569bea306579e7f9ab0a05d7`
- Media files: 405
- Snapshot verification: passed

## Isolated Restore And Migration

The exact pre-deployment snapshot was restored into a disposable MariaDB 10.6 container. It had no production volume, no NAS write mount, and only a temporary loopback port. Temporary database and extracted media were removed after evidence was recorded.

- Result: `PASS`
- MariaDB image ID: `sha256:daacc2f260f8ec999daa5e03a017a23a7e6fa3fb982aaf26e8b72f24daf03bc9`
- Database storage: isolated 1 GiB `tmpfs`
- Host binding during the drill: loopback-only temporary port `33316`
- Production volume mounts: 0
- Tables: `29 -> 34`
- Completed Prisma migrations: `25 -> 26`
- Migration applied: `20260718090000_mu_contract_order_sync`
- Second migration run: no pending migration
- Existing `OrderTracker` rows before synchronization: 50
- Protected aggregate fingerprint before/after migration: `ce15da15a528359dd4514a846cbfa7d4a5e8533b17f1ba4237f3365fb18de33c`
- Five integration tables existed and were empty before first synchronization
- `mariadb-check`: 34 tables passed
- Restored media: 405 files; representative PNG, JPEG, and PDF files passed validation

## Controlled Deployment

- MULEDGER application version: `1.0.210`
- MULEDGER migration state: 26 completed, none pending
- MU Contract application version: `0.1.256`
- MU Contract migration state: `20260719_0049`
- MULEDGER app, Caddy, maintenance trigger, and MU Contract sync trigger: running
- Public MULEDGER homepage: HTTP 200
- Source and consumer tokens: configured and matched without recording their values

The safe deployment recreated application services only. It did not remove or recreate the production database, Docker volumes, NAS upload directory, Caddy data, or certificates.

## Source Initialization And Full Reconcile

MU Contract historical projection initialization:

- Source PI rows: 53
- Dry-run: 53 eligible, 0 skipped
- Apply: 53 projections and 106 source events
- Maximum source cursor: 106
- Second apply: 0 changes
- Source PI and workflow data fingerprints: unchanged

MULEDGER Full Reconcile:

- Source PI rows: 53
- Existing Orders attached without replacing manual ownership: 40
- New synchronized Orders created: 13
- Existing MULEDGER-only Orders preserved: 10
- Unmatched rows: 0
- Conflicts: 0
- Resulting Orders rows: 63
- Source links: 53, all `MATCHED`
- Link modes: 40 `MANUAL_ATTACHED`, 13 `SYNC_CREATED`
- Committed cursor: 106

## Enablement And Idempotency

Synchronization was enabled through the authenticated Settings API, not by editing the database. The scheduled trigger then completed successfully. A separate administrator `sync-now` call returned:

```json
{
  "status": "completed",
  "processed": 0,
  "conflicts": 0,
  "committedCursor": "106"
}
```

Final status:

- Enabled: true
- Initial Full Reconcile: completed
- Running task: none
- Last error: none
- Unmatched: 0
- Open conflicts: 0
- Poll interval: 30 seconds
- Batch size: 100

Before and after enablement, complete row counts and deterministic Prisma row fingerprints were identical for `OrderTracker`, `Order`, `Invoice`, `Receipt`, `Detail`, and `Swift`. This proves the zero-event incremental run was idempotent and did not silently modify business data.

The pre/post enablement counts were:

| Table | Rows |
| --- | ---: |
| `OrderTracker` | 63 |
| `Order` | 143 |
| `Invoice` | 35 |
| `Receipt` | 222 |
| `Detail` | 20 |
| `Swift` | 20 |

## Post-Enablement Snapshot

Snapshot:

`/Volumes/团队文件-DAINTY_SHIPMENT/docker/backups/muledger/snapshots/2026/07/19/muledger-20260719-193956`

- Database SHA-256: `5347a07fafce9df2c2f5e510f60995c0645e86a613a6aa034d6d83bb0e577d89`
- Media SHA-256: `b86c274610804be9ac2ea190bc9e0a0486040ff86e023999d46c0afbdfe53399`
- Media files: 405
- Snapshot verification: passed during publication and passed again through explicit `--verify`

## Rollback

If the source integration must be stopped, disable it through Settings and stop only `mucontract-sync-trigger`. Preserve the integration tables and synchronized Orders for audit history. Do not use `docker compose down -v`, delete database volumes, or use business Rematch as an integration rollback.

For data recovery, verify a selected NAS snapshot, restore it into a new isolated database, validate it, and switch only after approval. Never restore directly over `trading_ledger`.

## Data Risk

`checked`

The production migration was additive, the exact backup passed isolated restore, all protected financial data fingerprints remained unchanged, no media path changed, and a complete post-enable snapshot was published successfully.
