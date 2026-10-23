# Partial SWIFT Status Correction Drill

Result: PASS, 2026-10-23. No production database or upload mount was used.

- Disposable MariaDB 11 container `muledger-partial-swift-drill-20261023`, tmpfs
  data, random loopback port, separate database `partial_swift_drill`.
- Applied existing migrations only. Synthetic Detail USD 75,093 and Receipt had
  the old Bank_Transfer state; one SWIFT USD 50,000 was already RECEIVED.
- Default dry-run selected the Detail without changing it. ADMIN apply corrected
  Detail and Receipt to Waiting_SWIFT and wrote before/after audit. The complete
  SWIFT row was unchanged, including amount, date and RECEIVED status.
- Second apply changed zero rows. A database trigger deliberately rejected audit
  creation; the transaction rolled back both Detail and Receipt changes. The
  expected synthetic audit error was caught and its rollback postconditions passed.
- Removed the synthetic failure trigger and corrected again. Dumped/restored into
  `partial_swift_roundtrip`; Detail/Receipt states and amounts, SWIFT status/date,
  and audit metadata were identical. CLI dry-run returned zero remaining candidates.
- Removed the disposable container. Notification keys were empty and sending was
  disabled throughout. No real messages or business records were created.

Production rollout requires a verified fresh full snapshot, reviewed dry-run,
safe rebuild, explicit ADMIN apply and a zero-candidate follow-up preview. No
schema migration or media operation is involved.
