# Customer outstanding WhatsApp reminders

Status: implementation in progress; outbound reminders disabled until review and delivery verification.

## Confirmed rules

- One schedule per customer, driven by the earliest released order with live balance strictly above USD 20. Use Dashboard's shared balance calculation.
- 30 days: once. 60 days: every 14 days. 120 days: every 7 days. 180 days: every 3 days. Higher stages replace lower stages.
- Existing overdue orders receive only the current stage, never historical catch-up messages.
- When the anchor order is settled, use the next eligible order and respect the last customer send time under the new interval; no immediate catch-up.
- Check daily at 07:00 Africa/Conakry; retain the five-minute buffer, pending deletion holds, consent checks and ADMIN cancellation.
- Always French. Regenerate the complete customer statement using the same template as Dashboard download, including in-transit orders and small balances. Do not call the entire statement total overdue.
- Freeze the submitted image/text for audit, not for reuse by future reminders.
- Existing notifications must remain unchanged. No automatic real-customer tests.

## Delivery sequence and gates

1. Pure customer-level schedule evaluator and boundary tests.
2. Shared browser/server statement renderer and French labels; generation tests.
3. Durable queue integration, live refresh, media send, consent/cancellation/idempotency and deletion holds; isolated API tests.
4. ADMIN settings and four editable French image-template drafts; sample preview and provider review.
5. Backup/restore coverage, CI, PR review/merge and safe local deployment. Enable only after approved templates and controlled delivery verification.

## Safety

No financial writes. Additive persistence only; validate migrations in isolation before deployment. Notification state must be covered by the complete `trading_ledger` snapshot and archived media by `UPLOAD_HOST_DIR`, as described in `docs/backup/muledger-local-backup.md`. Rollback disables the reminder switch without deleting history.
