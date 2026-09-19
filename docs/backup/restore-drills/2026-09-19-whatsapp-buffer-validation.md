# WhatsApp Buffer: Isolated Validation

## Scope

Migration `20260919000100_whatsapp_send_buffer` was applied by the existing
isolated API/E2E runners against `127.0.0.1:3307/trading_ledger_test`, using
separate Compose project names and temporary upload directories. WhatsApp
provider keys were blank and outbound/webhook flags disabled.

## Verified

- Persisted five-minute deadline survives API rereads.
- Concurrent approval accepts one revision and rejects the stale approval.
- Deletion request creates a pause; rejection clears approval and restarts buffer.
- Deleting receipt A ($2,000) updates receipt B ($3,000) balance from $5,000 to
  $7,000 for a $10,000 order, without changing its receipt amount.
- B is held while A's deletion is pending.
- Explicit ADMIN cancellation remains cancelled after subsequent source edits.
- Consent revocation and management permissions remain enforced.
- Desktop 1280px and mobile 390px notification table/cancel interaction pass.

This is isolated migration/behaviour validation, not a new full backup restore
drill. No production migration, data changes or external WhatsApp sends were
performed. The full MySQL snapshot continues to cover the added metadata.

## Before Production Release

Check the latest backup, review the additive migration and preserve cancellation,
pause, correction links and scheduled timestamps during recovery. Keep outbound
disabled when restoring or rolling back to a pre-buffer application. Review and
obtain platform approval for the new correction templates; do not fall back to a
payment-received template when a correction template is unavailable.
