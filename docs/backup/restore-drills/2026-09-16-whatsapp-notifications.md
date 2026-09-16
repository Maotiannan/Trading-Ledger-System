# WhatsApp Migration And Restore Drill

Result: PASS (2026-09-16). No production database or media source was changed.

- Verified source: NAS snapshot `2026/09/16/muledger-20260916-093526`, created by the existing Docker backup runner; database plus 546 media files verified.
- Target: disposable `muledger-wa-restore-20260916`, MariaDB 10.6.27, tmpfs database storage, loopback port 65081, no host/NAS database mount or production Compose network.
- Restored into `trading_ledger_test`. Applied only `20260915120000_whatsapp_delivery_foundation`.
- CHECKSUM TABLE values for Customer, Receipt, Order, Invoice, Detail, Swift and AuditLog were unchanged by migration.
- Added synthetic consent, UNCERTAIN delivery/claim and unapplied callback fixtures in the isolated copy. Dumped it and restored into `whatsapp_roundtrip` in the same disposable instance.
- Round-trip checksums matched: CustomerWhatsAppContact 3164380721; WhatsAppDelivery 3874968318; WhatsAppWebhookEvent 613743273.
- External sending disabled. No test WhatsApp messages sent by this drill.

Initial import attempt ran before authenticated database readiness and returned access denied (1045). After confirming SELECT 1 with the isolated credentials, import succeeded. The failed attempt did not access production.

Remaining deployment gate: provider template approval and a real test delivery/webhook round trip are separate from this successful data recovery drill.
