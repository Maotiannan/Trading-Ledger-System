# Admin-Approved Customer Email Notifications Design

Date: 2026-09-01

Status: Approved in conversation

## 1. Purpose

Add customer-facing payment, shipment, and release email notifications without allowing the system to contact customers automatically. Business events create reviewable email tasks, and only ADMIN-or-higher accounts can send them from a dedicated Email Management page.

The first release covers formatted HTML and plain-text email bodies only. It does not attach Receipt images, invoices, PDFs, or other business files.

## 2. Confirmed Business Rules

### 2.1 Customer notification contacts

- A customer may have zero, one, or multiple notification email addresses.
- Email addresses are optional; missing addresses do not block customer, Receipt, or Invoice writes.
- One address is the primary address whenever at least one address exists.
- Customer Management shows the primary address in a new `EMAIL` column. If additional addresses exist, the cell also shows their count and opens a management dialog.
- The dialog supports adding, editing, deleting, and selecting the primary address.
- Duplicate addresses are rejected for the same customer.
- Deleting the primary address requires another address to become primary. If only one address remains, it becomes primary automatically.
- Validation checks email syntax only. It does not send a verification link or claim that the mailbox exists.
- Validation must not use a provider allowlist or restrict common international domains, subdomains, long suffixes, plus-addressing, or enterprise mail domains.
- The frontend and backend use the same validation contract, with the backend remaining authoritative.
- SALES-or-higher accounts may maintain notification addresses only for customers in their existing visibility scope.

### 2.2 Language preference

- Customer Management adds a `LANGUAGE PREFERENCE` column.
- Supported initial values are `English` and `Francais`.
- `English` is the default.
- One preference applies to all notification addresses belonging to the customer.
- Email preview may temporarily switch language without changing the customer's saved preference unless the administrator explicitly saves that customer change.
- Language support is modeled as extensible configuration rather than duplicated conditionals in individual email features.

### 2.3 Global recipient mode

Email Notification Settings provides one system-wide multiple-recipient mode:

- `Primary + CC`: the primary address is the recipient and remaining addresses are CC recipients.
- `Separate delivery`: the same message is delivered separately to every address.

`Primary + CC` is the default. Per-customer overrides are not part of the first release.

### 2.4 Permissions

- SALES-or-higher accounts may maintain email addresses and language preferences within their existing customer scope.
- SALES accounts cannot view Email Management, preview queued customer email, send email, cancel email, retry email, or generate correction notices.
- Email Management and all email-administration APIs require ADMIN-or-higher permission.
- ADMIN-or-higher accounts may preview, send, batch send, cancel, retry, and generate correction notices within their existing data visibility scope.
- Authorization is enforced by the backend, not only by navigation or button visibility.

## 3. Notification Events

### 3.1 Payment received

- Every successful Receipt creation creates one payment notification task.
- Task creation covers every Receipt write path, including direct creation, uploads, signed-receipt generation, and receipts produced by Payment Details.
- The task is created immediately after the Receipt is successfully persisted; it does not wait for final `RECEIVED` status.
- This does not send email automatically. ADMIN review remains mandatory.
- If the Receipt changes before sending, the pending notification resolves and previews the latest valid business data.
- If the Receipt is deleted before sending, the pending notification is cancelled.
- If the Receipt changes after sending, no duplicate message is generated automatically. The original task is marked as requiring correction review.

### 3.2 Shipment

- The first transition from no Shipment Date to a populated Shipment Date creates shipment notification tasks.
- One Invoice containing multiple customers produces one task per customer.
- One customer with multiple ORDER NO values in the same Invoice receives one combined notification.
- A customer sees only that customer's orders and never another customer's information from the Invoice.
- Before sending, edits to the date or Invoice-to-order associations update the pending preview.
- After sending, edits do not send again automatically and instead mark the original task for correction review.

### 3.3 Release

- The first transition from no Release Date to a populated Release Date creates release notification tasks.
- Customer splitting, same-customer order grouping, pending updates, and post-send correction behavior follow the Shipment rules.

### 3.4 Duplicate prevention

- Each original business event and customer combination has one stable notification identity.
- Repeated saves, imports, rematching, retries, page refreshes, and process restarts cannot create duplicate original tasks.
- A correction notice is a new, explicitly created task linked to the original sent task.
- Clearing and repopulating a date does not create another original task if that customer event already exists.

## 4. Missing Recipient Handling

- A notification task is still created when the customer has no email address.
- Its status is `Missing Recipient` and sending is disabled.
- Adding a valid customer email automatically makes all otherwise-valid missing-recipient tasks eligible for `Pending` status.
- The original Receipt or Invoice does not need to be edited again.
- Removing all addresses before sending returns affected tasks to `Missing Recipient`.

## 5. Email Management

### 5.1 Page and navigation

Add a dedicated `Email Management` page and navigation entry visible only to ADMIN-or-higher accounts.

The page supports searching by customer, MARK, ORDER NO, INV NO, and Receipt No. Filters cover notification type, status, and creation date.

Each business notification row shows:

- creation time;
- notification type;
- customer and MARK;
- primary email and additional-recipient count;
- language preference;
- Receipt No or INV No;
- ORDER NO values;
- current status;
- available actions.

### 5.2 Statuses

- `Pending`: ready for ADMIN review and send approval.
- `Missing Recipient`: no valid customer email is available.
- `Queued`: ADMIN approved sending and the worker has not claimed it yet.
- `Sending`: the worker owns the current attempt.
- `Sent`: all required delivery operations succeeded.
- `Partially Sent`: separate delivery succeeded for some addresses and failed for others.
- `Failed`: delivery failed and may be retried.
- `Delivery Uncertain`: the provider call outcome cannot be determined safely; automatic retry is stopped to prevent duplicate customer email.
- `Cancelled`: ADMIN cancelled the task or its source was deleted before sending.
- `Needs Correction`: the source changed after a successful send.

### 5.3 Actions

ADMIN-or-higher accounts may:

- preview a pending message;
- temporarily preview another supported language;
- send one message;
- select and batch-send multiple reviewed messages;
- cancel a task that has not been sent;
- retry failed recipients without resending successful separate deliveries;
- inspect delivery attempts and provider responses;
- generate a correction notice for a changed sent task.

Sending freezes the effective recipients, language, subject, HTML body, plain-text body, and referenced business values as an immutable sent snapshot. Later template or customer changes do not rewrite sent history.

## 6. Email Notification Settings

Add an ADMIN-only collapsible Email Notification Settings section containing:

- global feature switch;
- global recipient mode;
- sender display name;
- sender address;
- reply-to address;
- configurable retry limits and intervals;
- test-delivery mode and its ADMIN-owned destination address;
- English and French templates for Payment Received, Shipment, and Release.

The feature switch defaults to off after deployment. Test-delivery mode redirects delivery to the configured administrator address and must make that redirection explicit in the preview and audit record.

Secrets such as the Tencent Cloud API secret are environment variables and never database settings, client responses, source files, or Git content.

## 7. Templates and Rendering

- Each event has independently editable English and French subject and body templates.
- Templates use a controlled variable catalog for customer name, MARK, ORDER NO, INV NO, Receipt No, amount, payment date, Shipment Date, and Release Date as applicable.
- Required business fields cannot silently disappear from a template. Validation reports missing required variables before a template can be activated.
- The rendered email uses a mobile-friendly, email-client-compatible table layout with inline styles, MU branding, logo, headings, and business information cards.
- The logo uses an approved HTTPS-hosted asset and includes alternative text because email clients may block remote images.
- Every HTML message has an equivalent plain-text body so the notification remains readable when HTML or images are blocked.
- No file attachments or inline business documents are included in the first release.

## 8. Architecture and Transactions

### 8.1 Shared notification service

Create one business-notification service used by all Receipt and Invoice write paths. Individual pages and API routes do not implement their own notification rules.

The service is responsible for:

- recognizing supported business events;
- resolving customer ownership and visibility;
- grouping Invoice orders by customer;
- creating stable, duplicate-safe notification tasks;
- refreshing pending eligibility after customer email changes;
- marking sent notifications for correction review after source changes.

### 8.2 Transactional outbox

The business write and notification task creation occur in the same database transaction. A successful Receipt or date transition cannot lose its notification task, and a failed business write cannot leave an orphan notification.

The initial implementation uses the existing MySQL database as a durable outbox. It does not add Redis or an external queue at the current system scale.

### 8.3 Delivery worker

A lightweight delivery worker runs from the application image as a separate process. It atomically claims ADMIN-approved tasks, calls Tencent Cloud Email Push, records per-recipient delivery outcomes, and applies configured retry rules.

The worker must survive restarts without losing queued work and must not allow two worker instances to send the same claimed delivery concurrently.

For `Primary + CC`, one provider delivery record covers the primary and CC recipients. For `Separate delivery`, one business notification owns separate per-address delivery records so successful addresses are not resent when failed addresses are retried.

## 9. Audit and Error Handling

The system records:

- who created the source business record;
- who approved sending;
- who cancelled or requested a retry;
- source event and source record identity;
- recipient mode and resolved addresses;
- selected language and template version;
- final subject, HTML, plain text, and business-value snapshot;
- every attempt time, result, provider message identifier, and safe failure reason;
- correction linkage and reason.

Customer-facing and administrator-facing errors use localized, human-readable messages. Provider secrets and raw sensitive responses are excluded from client output and structured logs.

## 10. Data and Backup Impact

The implementation will add database-backed customer email, language preference, settings, templates, notification tasks, delivery attempts, recipient outcomes, and sent snapshots.

- These records remain inside the existing `trading_ledger` MySQL database and are covered by the full database snapshot defined in `docs/backup/muledger-local-backup.md`.
- No new customer-uploaded or generated business-file directory is introduced.
- The approved logo is a deployed application asset, not mutable business data.
- Implementation must update the backup inventory and restore checklist to name the new email tables and verify they restore with the database snapshot.
- The schema migration must be exercised in an isolated restore environment before production deployment.

## 11. Automated Verification

Automated API, service, and worker tests must verify:

1. Customer email is optional.
2. Multiple addresses, primary selection, editing, deletion, and duplicate rejection work.
3. Common valid international, enterprise, subdomain, long-suffix, and plus-address formats are accepted while malformed input is rejected.
4. SALES may maintain visible-customer email data but cannot access any email-management read or write API.
5. ADMIN-or-higher access and customer visibility boundaries are enforced by the backend.
6. Every Receipt creation path creates exactly one task per applicable customer event.
7. First Shipment Date and Release Date population creates tasks while repeated saves and date clear/repopulate cycles do not duplicate them.
8. Multi-customer Invoices are separated and same-customer orders are combined without data leakage.
9. Missing-recipient tasks become pending after email maintenance and return to missing when all addresses are removed.
10. English and French rendering uses the correct customer preference and required business values.
11. `Primary + CC` and `Separate delivery` produce the expected recipient operations.
12. Concurrent approval, worker claiming, retries, and restarts do not duplicate delivery.
13. Separate-delivery retries target only failed addresses.
14. Source deletion cancels unsent tasks, pending source edits refresh previews, and sent source edits require correction review.
15. Sent snapshots remain unchanged after later template, language, address, Receipt, or Invoice edits.
16. Test-delivery mode redirects recipients and records both intended and actual test destinations.
17. Migration and rollback procedures preserve all existing Customer, Receipt, Invoice, and order-balance behavior.

## 12. Delivery Sequence

1. Add customer email and language-preference persistence, API contracts, permissions, and Customer Management UI.
2. Add Email Notification Settings, provider-independent template rendering, preview, and test-delivery configuration.
3. Add the shared notification service and transactional outbox integration to all Receipt and Invoice write paths.
4. Add the ADMIN-only Email Management page and APIs.
5. Add the provider adapter, delivery worker, retries, duplicate protection, delivery audit, and correction flow.
6. Run the full automated suite and isolated migration/restore verification.
7. Deploy with the feature disabled, configure the verified sending domain, SPF, DKIM, DMARC, sender identity, and Tencent Cloud credentials.
8. Enable test-delivery mode, inspect real generated previews, and verify actual delivery only to the administrator address.
9. Enable production manual sending after business-template approval. Automatic customer sending remains out of scope.

## 13. Complexity and Operating Cost

This is a medium-to-high complexity feature because reliable event coverage, customer isolation, duplicate prevention, and delivery recovery are more important than the provider API call itself. The expected implementation size is approximately six to nine focused development days including migration, frontend, backend, worker, tests, isolated deployment, and verification.

Tencent Cloud Email Push is the recommended first provider. As documented when this design was approved, each account has a one-time 1,000-message free allowance and usage beyond that is billed at CNY 0.0019 per message. The current system volume does not justify a dedicated IP. Provider pricing and account eligibility must be rechecked immediately before implementation:

- https://cloud.tencent.com/document/product/1288/47930
- https://cloud.tencent.com/document/product/1288/47454

The existing server and MySQL deployment are sufficient; the first release does not require another database, Redis, or a paid message-queue service.

## 14. Explicit Non-Goals

- No fully automatic customer sending.
- No SALES access to Email Management or send actions.
- No per-customer recipient-mode override.
- No mailbox ownership verification link.
- No attachments, Receipt images, Invoice PDFs, or release documents.
- No SMS, WhatsApp, or marketing campaigns.
- No dedicated sending IP at the current volume.

