# WhatsApp Notification Operations

## Release State

The existing receipt/shipment/release notifications are in production. On
2026-10-08, all four French outstanding-reminder templates were confirmed APPROVED
and UTILITY with exact content verification. Four synthetic image+text tests to
the configured, user-authorized destination returned DELIVERED through the real
webhook. The four templates are active. Production reminders were enabled and
then paused after the first live batch returned BALANCE_INSUFFICIENT. Current
state: reminderEnabled=false and reminderTestMode=false. Existing transactional
notification settings were preserved, but share the same depleted provider balance.

This was a configuration-only rollout of deployed version 1.0.226, not a new
application build or database migration. The approved correction templates were
also refreshed locally; no correction messages were sent during this rollout.

## Business Rules

- Receipt, shipment and release notifications reuse the existing transactional
  business snapshots; there is no second financial balance formula.
- The asynchronous projector reads original EmailNotification event snapshots,
  independently of email approval/sending. Email admin cancellation does not
  cancel WhatsApp; source removal/rebinding/changed content blocks unsafe sends.
- Only events after activation and contacts already opted in at event time qualify.
  Existing customer phones are never automatically opted in. No historical backlog.
- Customer notificationLanguage selects English or French.
- Testing requires ADMIN approval and freezes the actual test recipient on each task.
  Switching to production starts a new event window; test tasks are not converted.
- Production queues new eligible events automatically without approval.
- Shipment container number remains out of scope until its business source is defined.

## Management

### Customer Outstanding Reminders

- Separate ADMIN settings `reminderEnabled` (default false) and `reminderTestMode`
  (default true) do not change existing receipt/shipment/release notification mode.
- Daily scan starts at 07:00 Africa/Conakry, catching up once after downtime without
  replaying missed slots. One customer schedule uses the oldest released order
  with live balance strictly greater than USD 20. All balance formulas are shared
  with Dashboard, including exclusion of SIGNING_PENDING receipts.
- Stages: once at 30 days; every 14 days from 60; every 7 days from 120; every 3
  days from 180. Escalation replaces the previous cadence. An anchor change respects
  the customer's previous-send interval rather than generating an immediate reminder.
- Unique customer/mode/date event keys, serializable scheduling and sending claims
  prevent duplicate tasks. Cancelled and failed attempts consume their slot and
  cooldown; uncertain sends block further reminders pending reconciliation. A
  recorded cleared-debt episode allows future debt to start a new schedule.
- The full statement is generated in French with the same SVG renderer and labels
  as Dashboard download. Text sums only released orders over USD 20 and at least
  30 days old; in-transit amounts are not described as overdue. The PNG and text
  derive from the same frozen, pre-claim live snapshot. Image preparation failure
  sends nothing and records `REMINDER_IMAGE_FAILED`.
- Five-minute buffering, current PHONE, consent, unsubscribe, pending deletion
  holds and ADMIN cancellation apply. Material changes invalidate test approval.
  A posted message cannot be recalled. No blind retry of ambiguous sends.
- Four editable French image-template drafts are available in the existing editor.
  Review copy and use `/detail-export/outstanding-reminder-sample.png` (fictional
  data only) at the deployment's HTTPS origin as the provider sample. Save a new
  draft before submitting. All four approved Utility versions must be active
  before enabling production reminder mode. Provider approval is not assumed.
- Tests remain directed to the configured test number, requiring ADMIN approval.
  Test tasks never become production deliveries. After platform approval, verify
  one controlled image+text delivery before enabling real-customer reminders.
- Data/rollback coverage: [backup runbook](backup/muledger-local-backup.md).

Provider contracts checked during implementation:
[template creation](https://docs.ycloud.com/reference/whatsapp_template-create),
[media upload](https://docs.ycloud.com/reference/whatsapp_media-upload).

### Five-minute buffer (new release; migration required)

- Automatic tasks persist `nextSendAt`; the worker cannot claim before this time.
- Before claim and when the list refreshes, live receipt/invoice/customer fields
  replace unsent snapshots. Material changes reset five minutes and invalidate
  prior test/correction approval. Unrelated edits do not reset the deadline.
- Receipt balances use recording order (`createdAt`, then ID for ties), excluding
  later receipts and SIGNING_PENDING, with the shared financial balance function.
- Pending deletion requests pause notifications transactionally. A rejected
  request resumes with a fresh buffer; an actually deleted source cancels on
  reconciliation. Requested deletion does not itself change financial balances.
  Later receipts whose balance includes the receipt under review are also held
  on live reconciliation, and always checked before claim.
- ADMIN may cancel a pending/queued/paused task. Cancellation is audited and
  cannot win after a sending claim. Projection does not recreate cancelled tasks.
- The list refreshes every 15 seconds while visible, without overwriting settings.
  The worker reconciles every scheduled run (normally 30 seconds), and rechecks
  inside a serializable transaction immediately before claim. Submission remains
  irreversible; never promise recall after provider submission.
- Buffered payment notifications already submitted can generate one grouped
  correction per customer/order when their source changes or disappears. Such
  tasks always need ADMIN approval, including production mode. Original messages
  remain immutable. Old pre-buffer sent history is not retrospectively replayed.
- `muledger_correction_v1` English/French are local draft texts only; copy/edit,
  submit and activate an approved Utility version through the template editor
  before using corrections. Never send corrections using a payment-received
  template. Provider approval and a controlled test remain release prerequisites.

- ADMIN: /whatsapp, settings, previews, paginated history and test approval.
- ADMIN can use Safe retry only on an explicitly FAILED delivery. Retry creates a
  new child delivery with `retryOf`, keeps the failed parent immutable, rechecks
  the current customer phone, consent, source/balance and approved template,
  regenerates reminder media when applicable, and waits five minutes again.
  ACCEPTED, SENT, DELIVERED, READ and UNCERTAIN deliveries are never retryable.
  A retry does not resurrect or rewrite the original event and is audited.
  Each failed record permits only one direct child, protected by the unique
  `eventKey=retry:<failed-id>` and a transaction. If that child explicitly fails,
  retry the child, not its parent. Stale requests return 409. Provider-backed
  failures are rechecked with YCloud before queueing and before dispatch; an
  unavailable provider or an uncertain result blocks sending. A later successful
  callback for any ancestor cancels its unsent retry. Test and correction retries
  retain approval requirements. Historical failed claims are retained unchanged.
  Explicit provider failures release the sending claim; transport-uncertain
  outcomes keep their claim and remain blocked until reconciliation.
- Customer contact API: ADMIN/SALES with existing customer scope. The WhatsApp page
  offers ADMIN contact maintenance, including consent evidence and opt-out.
- Opt-out cancels pending/queued deliveries. Already submitted messages cannot be recalled.
- In Notifications > WhatsApp > Customer Numbers & Consent, search and select a
  customer to see their current subscription. Use Unsubscribe and confirm to opt
  out; optional evidence is saved, otherwise the audit records an administrator
  opt-out. To subscribe again, check consent, enter evidence and save. Cancelled
  deliveries are not reactivated by subscribing again.
- Failed/uncertain submissions are visible. No automatic retry of unknown outcomes.
  Do not clear claimToken or move SENDING/UNCERTAIN back to QUEUED manually.

## Configuration

Deployment credentials: YCLOUD_API_KEY, YCLOUD_WABA_ID, YCLOUD_SENDER_PHONE,
YCLOUD_WEBHOOK_SECRET. Never store keys in Git or logs.

Deployment gates (default false): WHATSAPP_OUTBOUND_ENABLED and
WHATSAPP_WEBHOOK_ENABLED. Database SystemSetting key whatsapp.notifications stores
outboundEnabled, testMode, testDestination and activatedAt; no secrets.
Both deployment and database sending switches must be enabled to send.

The dedicated Compose trigger calls POST /api/internal/whatsapp/dispatch every
30 seconds using the existing maintenance token. Disabled deployments do no work.
A batch submits at most ten eligible messages. The source snapshot, current consent,
test mode/destination, and provider APPROVED + UTILITY classification are checked.
Only POST /api/whatsapp-notifications action=approve permits testing; SALES/USER
cannot query/manage notifications or settings.

## Provider Protocol

- POST https://api.ycloud.com/v2/whatsapp/messages; X-API-Key auth; from is E.164 phone.
- externalId is the local delivery ID, a correlation field, not a documented
  provider deduplication guarantee. Atomic claims prevent concurrent sends.
- Persist accepted/rejected/uncertain outcomes. Never retry ambiguous network or
  post-send database failures. Expired sending claims become UNCERTAIN.
- Subscribe only to whatsapp.message.updated at /api/webhooks/ycloud.
- Verify YCloud-Signature t=timestamp,s=hex using HMAC-SHA256(timestamp.rawBody);
  reject timestamps outside five minutes and wrong WABA/sender.
- Persist before 200; storage failures return 503. Duplicate event keys are unique.
  Statuses only progress; late SENT cannot overwrite DELIVERED or READ.
- Unapplied events are replayed by the trigger. Sender/recipient and message ID
  or delivery externalId must match. Inbound chat history is not subscribed.

References:
- https://docs.ycloud.com/reference/whatsapp_message-send
- https://docs.ycloud.com/reference/whatsapp_template-create
- https://docs.ycloud.com/reference/configure-webhooks

## Data Safety And Rollout

New tables: CustomerWhatsAppContact, WhatsAppDelivery, WhatsAppWebhookEvent.
The failed-delivery retry release adds only the nullable `WhatsAppDelivery.retryOf`
self-reference and index; it does not rewrite existing deliveries or financial data.
All are covered by the full trading_ledger dump. Settings/audits use existing tables.
No new media directory. See [backup runbook](backup/muledger-local-backup.md) and
[isolated migration/restore evidence](backup/restore-drills/2026-09-16-whatsapp-notifications.md).

Deploy only after required tests/CI, then use scripts/rebuild-local-app.sh.
Its application startup applies the additive migration. Reverting the app does
not require dropping the new tables. Disable outbound first on any incident.

Real test recipient: the current user-authorized number ending 1286, maintained in settings.
Do not create fake production financial records or consume customer notifications
for testing. Do not turn on production customer sending before template approval,
test delivery, callback verification and consent readiness.

## Unified Notifications And Template Versions

The sidebar uses /notifications with Email and WhatsApp tabs. Legacy /emails and
/whatsapp URLs redirect to the corresponding tab. Email settings/templates moved
from Settings to the Email tab; the old Settings section links to the new location.
Email and WhatsApp histories, approval rules and sending gates remain independent.

ADMIN can save a new WhatsApp draft, preview it, submit it, refresh provider review
status and activate an approved Utility version. Each save gets a unique name;
existing templates are never edited/deleted remotely. Submission claims the version
before POST. A timeout becomes SUBMISSION_UNCERTAIN; refresh via GET instead of
reposting. Activation rechecks provider approval/category and exact header/body/footer,
then serializes per type/language. Historical versions are retained for preview.

The existing six templates are imported as read-only built-ins; refresh their status
without duplicate submission. Variables retain their positional meanings. Drafts
must include all documented variables and respect title/body/footer limits.
Platform review may still reject otherwise valid text; local validation cannot
guarantee provider approval.

Persistence uses existing SystemSetting rows:
- whatsapp.template.<name>.<language>: version content/status/active flag.
- whatsapp.template-lock.<kind>.<language>: transactional activation lock.
- whatsapp.notifications.enabledTypes: independently enabled payment/shipment/release.
- AuditLog: draft creation, submission and activation actor/time.

No schema migration or new media path. Full database backup includes these rows.
Historical delivery templateName/languageCode/parameters remain unchanged.

## Customer PHONE Routing

Customer.PHONE is authoritative for pending and new deliveries. The contact row
records customer consent and its original phone for audit; it is not the destination
source. Customer consent continues across PHONE edits as explicitly requested.
At claim time, update only the unsent delivery's intendedTo and (production)
actualTo from the current customer phone. Test actualTo remains the test destination.
Invalid/ambiguous phone formats block sending; never fall back to the old number.
Sent/submitted/uncertain deliveries retain their original recipients and are never
resent because PHONE changed. Messages already submitted cannot be recalled.

One customer/event creates one delivery, even if legacy contact rows exist.
Opt-out applies to the customer and cancels all pending/queued deliveries.
PHONE edits do not grant consent to a previously unconsented new customer.

## 2026-09-17 Acceptance

Three French messages (payment, shipment, release) were projected from synthetic
business records in an isolated tmpfs MariaDB. Unapproved sends were blocked;
ADMIN approval allowed one send each; repeated projection/dispatch sent no duplicates.
Provider IDs: 6aab562f75cff7424c4d3a4e, 6aab5630e2a7e0179e9f86c2,
6aab563252a3685f0d191810. All returned sent and production webhook storage recorded
sent. Cost: USD 0.0077 each. No real customer financial records were created.
The user explicitly accepts sent as success, not proof of delivered/read.

The user confirmed existing customers have consented and authorized routing future
messages to updated Customer.PHONE automatically. On rollout, record consent for
the current customer set only; do not infer consent for future new customers.
Set production activation to rollout time, not original test activation.

## 2026-10-08 Outstanding Reminder Acceptance

- All four stage templates and both correction languages are APPROVED/UTILITY.
  Activation revalidated exact remote content through the existing template service.
- 18 targeted suites / 123 tests passed. The isolated WhatsApp API case passed,
  including concurrent scheduling, live refresh, threshold, cancellation, consent,
  ADMIN permissions and database/media restore. No real financial records were
  created or edited for testing.
- Four fictional French statements were generated through the shared Dashboard
  renderer, preserving small balances, in-transit orders and released-order days.
  Real image uploads and the production provider sender returned these message IDs:
  30d `6ac757dc871280044b86a1ac`, 60d `6ac757de59b22551cd3c8076`,
  120d `6ac757e0871280044b86a1fb`, 180d `6ac757e259b22551cd3c809a`.
  All four received DELIVERED callbacks; this is not a claim of being read.
- Tests used the provider sender with synthetic snapshots, not the production
  customer scheduler. Test messages are traced in AuditLog and WhatsAppWebhookEvent,
  not represented as customer delivery tasks. No test task can later become live.
- Test PNGs are archived at
  `UPLOAD_HOST_DIR/images/whatsapp-statements/rollout-test-20261008-<stage>d.png`.
  Audit/settings/webhook rows remain covered by the complete database backup;
  images remain covered by the complete upload archive. No backup scope changed.
- Enabling production caused one catch-up scan for 2026-10-08, with 22 live tasks
  initially QUEUED behind the existing five-minute buffer. Later execution status
  belongs to the notification history, not this static rollout record.
- All 22 live tasks generated and archived their statement images. At the rollback
  check, 14 had SENT/DELIVERED/READ status, five failed with BALANCE_INSUFFICIENT,
  one with 131026 (Message Undeliverable), and two with PROVIDER_REJECTED without
  a provider message ID. Do not infer the exact error behind the latter two.
- The provider balance endpoint confirmed USD 0.0072 remaining. Reminder sending
  was disabled with a before/after audit, without changing existing payment,
  shipment or release switches. No blind retries or top-ups were performed.
  Recharge is a user action. After recharge, reconcile failures before resuming;
  completed messages must not be resent. Failed reminder slots consume cooldown,
  so enabling alone does not immediately retry those failed messages.
- Rollback: disable only reminderEnabled; leave other notifications, sent history,
  templates, database schema and archived images intact.

### Individual failed-message retry controls

`reminderEnabled` controls automatic daily reminder projection. ADMIN may explicitly
retry one failed reminder with this switch off; its child still revalidates live
balances, consent, provider failure and the template, then waits five minutes.
`outboundEnabled` and the deployment outbound gate still stop all sending.
Retry conflicts include a machine-readable `detail.reason`; the UI explains the
blocker instead of always requesting a refresh. Successful retries return to the
first history page and show the new task's schedule or approval/pause requirement.
The failed parent's schedule remains blank because the schedule belongs to its child.

### Localized Template Management

The management interface follows the account's Chinese/English UI language;
customer-facing template text remains in its selected English/French language.
Delivery states and common failure codes have readable labels, with the code
retained for troubleshooting. Sent is not the same as delivered.

Select a notification type and language to edit and see only matching versions.
The editor initially loads the active saved template. Dynamic-field buttons show
localized meanings and fictional examples and insert at the cursor. The adjacent
preview substitutes fictional values, never live customer data. Reminder previews
show an explicitly labeled image placeholder; the internal title is not sent as
an image header. The review sample URL remains separate from generated customer
statement images. Desktop uses two columns; mobile stacks editor and preview.

Saving creates a draft only. Submit, refresh platform review status, and activate
remain separate actions. Approval and Utility category are still required for
activation. This UI change introduces no migrations, storage, outgoing messages,
or changes to consent, five-minute buffering, retry rules or sending switches.
