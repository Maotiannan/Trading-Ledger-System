# 2026-07-18 MU Contract Orders Migration Drill

## Result

`PASS`

Migration `20260718090000_mu_contract_order_sync` was applied to an isolated restore of the latest verified COS backup. No active service, production database, Docker volume, NAS mount, or COS object was modified.

## Source Backup

- COS object: `database/mysql/2026/07/18/trading_ledger-20260718-023005.sql.gz`
- Backup manifest source commit: `0796f8c`
- Database SHA-256: `4862cfb6e5e40db685b75c27b0c1cad5dcb8d7fd42ec87de304ff6334cb420e4`
- Gzip integrity: passed
- Restored media files: 414

## Isolation

- MariaDB: `10.6.27`
- Image: `mariadb@sha256:daacc2f260f8ec999daa5e03a017a23a7e6fa3fb982aaf26e8b72f24daf03bc9`
- Host binding: loopback-only temporary port
- Docker mounts: none
- Production Compose networks and volumes: not attached

## Migration Evidence

Before migration, the restored database contained 26 completed Prisma migrations, 29 tables, 49 `OrderTracker` rows, and none of the five MU Contract integration tables.

The first `prisma migrate deploy` applied exactly `20260718090000_mu_contract_order_sync`. A second run returned `No pending migrations to apply`.

After migration:

- all five integration tables exist;
- `OrderTracker.archivedAt` and `OrderTracker.archiveReason` exist and are nullable;
- all five integration tables contain zero rows before first synchronization;
- all 49 existing `OrderTracker` rows remain present;
- 23 protected business tables have the same row count and per-row aggregate SHA-256 before and after migration: `e7bbe25e5aa36614ba6a1134e433d3ea9d5152689db061ab89d4f9ecb08090a0`;
- all 414 restored media files match the recorded size and SHA-256;
- `mariadb-check` reports `OK` for all 34 post-migration tables.

## Data Risk

Checked. The migration is additive and the isolated rehearsal found no change to existing business rows or media. Production rollout must still create and verify a fresh database backup immediately before applying the migration, keep synchronization disabled during deployment, and require the ADMIN Full Reconcile preview before first activation.
