# Multiple SWIFT Migration And Restore Drill

Result: PASS, 2026-10-21. No production database or upload source was modified.

- Disposable target: `muledger-multiswift-drill-20261021`, MariaDB 11, tmpfs data,
  random loopback port, no production mounts or shared Compose network.
- Applied all previous migrations and inserted synthetic User, Detail (USD 75,093)
  and one RECEIVED Swift (USD 50,000), with its own date and file reference.
- Applied `20261021100000_multiple_swifts_per_detail`. CHECKSUM TABLE results for
  User, Detail and Swift were identical before/after. The unique index was removed;
  `Swift_detailId_idx` and `Swift_detailId_fkey` remained intact.
- Added a second Bank_Transfer Swift (USD 25,093) under the same Detail. Both dates,
  statuses and file references were preserved; aggregate amount was USD 75,093.
- Dumped the synthetic database with single-transaction/routines/triggers and
  restored it into `swift_roundtrip` in the disposable instance. Compared every
  Swift's id, detailId, amount, status, date and imageUrl, plus Detail total/status:
  identical. This verifies database/reference recovery; no real media was used.
- Isolated API tests additionally verified independent signoff, eight copies with
  accepted fees, approved copy deletion, unsafe receipt deletion rollback and
  concurrent overpayment rejection. Playwright verified desktop/mobile layout.
- The disposable container and temporary drill files were removed after success.

The full production database and existing upload archive remain the recovery
scope. Before deployment verify a current full NAS snapshot. Once multiple copies
exist, do not recreate the unique index or roll back to a one-copy application;
preserve records and apply a forward fix.

## Deployment Evidence

PR #55 merged on 2026-10-21. Fresh full snapshot `muledger-20261021-113902`
passed verification and included 671 media files. The safe rebuild completed with
exit code 0; migration applied successfully and Prisma reported no pending
migrations. Running version is 1.0.227. Before/after Detail and Swift counts were
36 and 33, respectively; the non-unique index remains and no test business records
were created in production.
