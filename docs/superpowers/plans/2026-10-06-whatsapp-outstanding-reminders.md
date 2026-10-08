# Customer outstanding WhatsApp reminders

Status: deployed and enabled on 2026-10-08 after approval of all four Utility
templates, four delivered synthetic image tests and isolated verification. See
`docs/whatsapp-notification-operations.md` for rollout evidence and rollback.

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

## Database change review

- The pending migration changes only `WhatsAppDelivery`: append `OUTSTANDING_REMINDER` to the notification type and add nullable `statementImagePath`. It does not update orders, receipts, balances or existing media.
- Keep a distinct notification type. Reusing `PAYMENT_RECEIVED` with a JSON discriminator would unnecessarily complicate history queries, scheduling, correction handling and reporting.
- The image path could technically live in JSON, but the nullable column provides an explicit archive reference without rewriting the frozen business snapshot. Existing rows retain a null value.
- Before production execution, obtain approval for these exact changes, verify the current database backup and media backup, and inspect the deployed database version and table size for ALTER TABLE locking impact. Additive does not mean lock-free.
- Deployment can apply migrations during startup; do not run the rebuild script as a way to bypass migration approval. Keep reminders disabled and test mode enabled until template approval and controlled delivery verification.
- Application rollback retains the additive schema and notification history. Do not remove the enum value or drop the column after reminder records exist. Full database restoration is a separate recovery decision because it could discard subsequent business writes.
- Implementation verification: 234 Jest suites / 1554 tests passed; isolated WhatsApp API case passed, including concurrent scheduling and database/media restore. The production schema was current at rollout. Provider approval and controlled real delivery were verified on 2026-10-08; 18 targeted suites / 123 tests and the isolated WhatsApp API case passed again before enablement.
