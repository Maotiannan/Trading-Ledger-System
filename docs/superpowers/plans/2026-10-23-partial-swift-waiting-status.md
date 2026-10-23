# Partial SWIFT Waiting Status

Status: ARCHIVED_COMPLETED. PR #56 merged; v1.0.228 deployed.

## Approved State Contract

- SWIFT cumulative amount below Detail total minus per-copy fee allowance:
  Detail and linked business receipts remain Waiting_SWIFT, even if a partial
  copy is already RECEIVED.
- Cumulative amount covers total within allowance, but a valid copy remains
  unsigned: Bank_Transfer.
- Covered and all valid copies signed: RECEIVED.
- Preserve each SWIFT's independent status and actual Balance. Preserve existing
  errors/overpayment protections and SIGNING_PENDING exclusion.
- Shared pure calculation remains authoritative for API summaries and writes;
  do not reimplement the state formula in UI or repair SQL.

## Historical Correction

The operator-only `scripts/reconcile-partial-swifts.ts` defaults to dry-run and
requires an explicit DATABASE_URL. Apply requires an existing ADMIN actor and
`--apply --actor-id=<id>`. It only selects Bank_Transfer Details with SWIFT copies,
then locks/rechecks each candidate, synchronizes through the shared service and
writes before/after audit in one ReadCommitted transaction. Completed/error/manual
flows are excluded; SWIFT rows, amounts and media are never edited. Retry is
idempotent. No public repair endpoint or new scheduled scan is introduced.

Run with the pinned operational runner:

```sh
npx --yes --package=tsx@4.20.6 tsx scripts/reconcile-partial-swifts.ts
# After verified backup and dry-run review:
npx --yes --package=tsx@4.20.6 tsx scripts/reconcile-partial-swifts.ts --apply --actor-id=<admin-id>
```

## Delivery Gates

Regression tests: partial upload, partial signoff, full upload, final signoff,
fee boundaries, deletion rollback, receipt state synchronization, idempotent
correction and audit failure rollback. Isolated synthetic database dump/restore
must preserve corrected state, amounts and audit. PR/full CI, merge, verified
production backup, safe app rebuild, scoped correction, read-only verification
and post-merge CI must complete before reporting delivery.

Backup/recovery: [runbook](../../backup/muledger-local-backup.md). No schema
migration, new dependency, file directory or notification behavior is added.

Isolated evidence: [correction/rollback/restore drill](../../backup/restore-drills/2026-10-23-partial-swift-status.md).

## Release Evidence

- PR [#56](https://github.com/Maotiannan/Trading-Ledger-System/pull/56), merge
  `0eee28d`; pre-merge [full CI](https://github.com/Maotiannan/Trading-Ledger-System/actions/runs/39892621204)
  passed: 243 suites / 1,591 unit tests, 26 isolated API cases and 16 browser tests.
- Full snapshot `muledger-20261023-110017` includes database and 676 media files;
  backup and independent verification both exited 0.
- Safe rebuild exited 0. Running version 1.0.228; 33 existing migrations with
  none pending. Internal/public homepage and static asset checks passed.
- ADMIN correction changed one Detail (USD 75,093; USD 50,000 already signed)
  and its 20 linked receipts from Bank_Transfer to Waiting_SWIFT. Exactly one
  transactional correction audit exists. The full SWIFT row, all amounts and
  file references were verified unchanged; follow-up dry-run found zero candidates.
- Post-merge checks are recorded in [main CI](https://github.com/Maotiannan/Trading-Ledger-System/actions/runs/39893361983)
  and the release-record commit's GitHub Actions check. No test financial records
  or notifications were created in production.
