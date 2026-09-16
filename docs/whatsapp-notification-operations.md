# WhatsApp Notification Operations

## Release State

Version 1.0.219 adds an ADMIN-only WhatsApp page. External sending remains disabled
until provider approval and real delivery verification. The six Utility templates
were submitted to YCloud; their latest observed status is PENDING. Do not describe
this as completed production messaging.

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

- ADMIN: /whatsapp, settings, previews, paginated history and test approval.
- Customer contact API: ADMIN/SALES with existing customer scope. The WhatsApp page
  offers ADMIN contact maintenance, including consent evidence and opt-out.
- Opt-out cancels pending/queued deliveries. Already submitted messages cannot be recalled.
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
All are covered by the full trading_ledger dump. Settings/audits use existing tables.
No new media directory. See [backup runbook](backup/muledger-local-backup.md) and
[isolated migration/restore evidence](backup/restore-drills/2026-09-16-whatsapp-notifications.md).

Deploy only after required tests/CI, then use scripts/rebuild-local-app.sh.
Its application startup applies the additive migration. Reverting the app does
not require dropping the new tables. Disable outbound first on any incident.

Real test recipient: the user-authorized number ending 7412, maintained in settings.
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
