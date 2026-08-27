# 2026-08-27 Receipt Transfer Reversal Migration Drill

## Result

`PASS`

Migration `20260827090000_balance_transfer_generated_receipt` and the incident reversal were exercised against an isolated restore of a newly verified NAS snapshot. The production database, running application, Docker volumes, and current NAS upload files were not modified by the restore, migration, or reversal drill.

## Source Snapshot

- Snapshot: `muledger-20260827-181124`
- Manifest commit: `ec4864b`
- Created at: `2026-08-27T10:11:32Z`
- Database SHA-256: `7fb86c6750f92e1425bdc8caad6a9f1f4d93d131d3bb4267ce91028078fd634e`
- Media SHA-256: `4022395c1497dda8deef59d85dcf2d8a0969f2e1337cdf51e6ac3200bef45ffb`
- Restored media files: `518`
- Snapshot verification: passed before and after publication

The backup dry-run passed before publication. The successful backup applied the configured 30-day retention policy and removed two expired 2026-07-19 snapshots only after the new snapshot passed verification.

## Isolation

- Drill ID: `muledger-transfer-20260827181221`
- MariaDB image: `mariadb:10.6` (`10.6.27` at runtime)
- Database container: `muledger-transfer-20260827181221-db`
- Database storage: container `tmpfs`; no Docker volume or host mount
- Host binding: `127.0.0.1:33317` only
- Application binding: `127.0.0.1:33318` only
- Restored media root: disposable `/tmp` directory
- Production Compose networks and volumes: not attached

The first readiness probe used `mariadb-admin ping`, which can report a temporary initialization server as alive before the configured root password is active. The attempted import stopped with `ERROR 1045` before any SQL was imported. Container logs proved the initialization race, and a real authenticated `SELECT 1` was used for the successful retry. No production resource was involved.

## Restored Baseline

| Table | Rows |
| --- | ---: |
| `Order` | 168 |
| `Invoice` | 38 |
| `Receipt` | 288 |
| `BalanceTransfer` | 1 |
| `Detail` | 29 |
| `DetailItem` | 235 |
| `AuditLog` | 330,038 |

The deterministic protected-business fingerprint before migration was:

```text
937c82b6487d59692042a52fbb80c1d8e7e9c1392e49fed06f86dc3c8fe2913c
```

The fingerprint uses ordered row dumps with comments disabled, so dump timestamps cannot create false differences.

## Migration Evidence

The restored incident data matched every expected identity and amount before migration:

- transfer `cmtauoavc005nn701ueemain2`: `$3,213` from `Super DT2-08 B` to `SUPER DT2-08B`;
- generated Receipt `cmtauoavj005pn701lzrs1rlz`: `TRANSFER-1787794481934`, `$3,213`, `Bank_Transfer`;
- real Receipt `cmszqlas40324mg01dy8ixzmg`: `0001170`, `$3,213`, `RECEIVED`;
- source Order `cmszqlaro0322mg01m25ueq3o`: amount/balance `$3,213`, `Un_Associated`;
- target Order `cmoqk9wwv01ptuc01yyb6okvr`: amount `$13,666`, cached balance `$7,240`, `L25MH090002B`.

The first `prisma migrate deploy` applied exactly `20260827090000_balance_transfer_generated_receipt`. The second run returned `No pending migrations to apply`.

Backfill assertions:

```text
cmtauoavc005nn701ueemain2  cmtauoavj005pn701lzrs1rlz
drill-ambiguous-transfer   NULL
```

The known 7-millisecond pair linked uniquely. A two-Receipt ambiguity fixture remained unlinked. After removing only the fixture:

- every baseline table count matched;
- the protected-business fingerprint remained `937c82b6487d59692042a52fbb80c1d8e7e9c1392e49fed06f86dc3c8fe2913c`;
- `BalanceTransfer_generatedReceiptId_key` was unique;
- the foreign key used `ON DELETE RESTRICT` and `ON UPDATE CASCADE`.

## API Reversal Evidence

The worktree standalone artifact initially failed to start because Next.js traced the parent checkout and omitted one nested `@swc/helpers` file. No API request or database write occurred. The same verified production build was then run from the worktree with its complete installed dependency tree; authenticated health and Receipt API probes passed before reversal.

The ADMIN-only public API was called twice using an in-memory short-lived session token that was neither printed nor persisted outside the permission-restricted drill directory:

- first call: success, `alreadyReversed: false`;
- second call: success, `alreadyReversed: true`.

Final assertions:

```text
synthetic_receipt_count  0
transfer_count           0
real_receipt             0001170  RECEIVED  3213.00  SUPER DT2-08B  L25MH090002B
target_balance           10453.00
source_order_count       0
reversal_audit_count     1
```

The structured balance logs also recorded the source balance changing from `3213` to `0` and the target balance changing from `7240` to `10453` under source `ADMIN_RECEIPT_ACTION`.

## Data Risk

`checked`

The migration is additive and conservatively backfills only unique historical matches. The drill proved that protected business rows and media were unchanged by migration, the incident reversal is transactional and idempotent, the real Receipt remains intact, and strict audit evidence is committed with the accounting changes.

Production migration and repair still require the verified snapshot above to remain available. The disposable application, MariaDB container, restored media directory, and temporary credentials must be removed after PR evidence is committed.
