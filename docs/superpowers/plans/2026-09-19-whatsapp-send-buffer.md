# WhatsApp Send Buffer

## Confirmed Behaviour

- Queue automatic notifications for five minutes. Content or recipient changes restart the buffer; unrelated edits do not.
- Read current business data before sending, with customer PHONE, language and consent revalidation.
- Payment balance means the balance after that receipt, not after later receipts. Reuse the financial balance formula.
- Pending deletion requests pause notifications. Approved deletion cancels them; rejection resumes with a fresh buffer.
- ADMIN can cancel unsent notifications permanently. A cancelled task must not be recreated by projection.
- Already submitted messages are immutable. Corrections require ADMIN approval and a separate approved Utility template; never masquerade as new payment receipts.
- Test messages still require approval. Material changes invalidate approval.

## Work And Verification

1. Add persisted scheduling/approval metadata and paused state, without changing financial records.
2. Implement live source resolution, transaction-safe refresh/claim/cancel and deletion-request checks.
3. Add notification list controls and correction templates/preview.
4. Cover timing, edits, deletion pending/rejected/approved, cancellation races, receipt sequence balances and permission boundaries.
5. Validate migration only in an isolated database; update backup/recovery guidance. Production migration/deployment requires explicit release approval.

## External Dependency

New correction templates need text review and YCloud/Meta approval. Until approved,
correction tasks must remain unsent. This work does not authorize sending real
customer test messages or rewriting historical sent snapshots.

## Implementation Status

Implemented on `feature/whatsapp-send-buffer`; not committed or deployed.
Full unit suite, targeted isolated API case and desktop/mobile Playwright checks
passed. Migration and recovery notes are in
`docs/backup/restore-drills/2026-09-19-whatsapp-buffer-validation.md`.
External template review/approval and production rollout remain outstanding.
