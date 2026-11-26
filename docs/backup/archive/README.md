# Backup history

Use the [current runbook](../muledger-local-backup.md) for operations. Historical reports below describe only the date and dataset tested, not the health of today's snapshot.

- [Original runbook at the reconciled baseline](https://github.com/Maotiannan/Trading-Ledger-System/blob/23ba6fff8c4d6cb25e78eeae75082904f0b4be70/docs/backup/muledger-local-backup.md): earlier retention, cloud retirement, receipt repair, notification recovery and migration-specific gates. Offline: `git show 23ba6ff:docs/backup/muledger-local-backup.md`. Historical paths and one-off repair actions are **not** current deployment instructions.
- [Restore drill records](../restore-drills/): NAS and historical COS restores, transfer reversals, email/WhatsApp, SWIFT, accounts/recovery, invoice sync, cancellations and prepayments.
- Keep new site-specific evidence (snapshot paths, hashes, selected image IDs and service logs) in private operations records, not a public changelog.
