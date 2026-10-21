# Multiple SWIFT copies per Payment Detail

Status: implementation and isolated verification complete; CI, merge and deployment pending.

## Approved scope

One Payment Detail accepts any number of SWIFT records, each with its own amount,
date and file. Preserve existing Detail and Swift status enums. Beside Total,
display SWIFT cumulative amount and the actual Balance. Unreceived SWIFT totals
are light red; received copies are green with per-copy status on hover. No fee
message is added to the amount row.

Only valid Bank_Transfer/RECEIVED copies count. Reject aggregate overpayment.
Each copy is signed independently, including when later copies have not yet been
uploaded. Complete Detail and linked receipts only when every valid copy is
received and actual shortfall <= count × USD 40. Store the per-copy cap in the
existing SystemSetting mechanism. Eight USD 9,980 transfers against USD 80,000
complete after the eighth signature, retaining actual Balance USD 160.

## Implementation

- Prisma: replace Detail.swift with Detail.swifts; drop only Swift_detailId_key.
  Keep Swift_detailId_idx, FK, enums and all historical rows/files.
- Shared Decimal calculation and transaction state synchronizer. Serialize writes
  on Detail, including approval paths; prevent receipt completion from bypassing
  pending SWIFT copies. Recalculate on deletion and detail amount changes.
- API returns grouped summary without N+1 reads. Upload options retain partial
  details. Existing file staging/attachment and permission checks remain active.
- UI: compact amount row, per-copy status tooltip, continued uploads with summary,
  desktop and mobile layouts. No new dependency or separate service.

## Verification and release

Unit tests cover partial/full, any number of transfers, fee limits, errors,
Decimal arithmetic, ownership, independent signatures, edits/deletion and assets.
Isolated API tests cover actual persistence, received first copy before the next
upload, eight-copy example, receipt bypass rejection, deletion approvals and
concurrent overpayment. Playwright verifies amount row, tooltip, selected detail,
continued upload and mobile bounds. Run project CI gates before merge.

Backup and recovery scope: [backup runbook](../../backup/muledger-local-backup.md).
Isolated migration/restore evidence: [drill](../../backup/restore-drills/2026-10-21-multiple-swifts.md).
Migration only removes a unique index, leaving financial amounts and media intact.
Validate pre/post-migration row preservation and a synthetic dump/restore in an
isolated database. Before live migration verify a fresh full snapshot. After
multi-copy adoption, preserve the schema and use a forward fix; do not recreate
the unique index or deploy an app assuming one SWIFT per Detail.
