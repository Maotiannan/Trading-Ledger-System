# Email Contact Layout And Production Activation

Status: ACTIVE. Latest user instruction: deploy the accepted templates without
resending samples; production outbound remains disabled pending final activation.
This plan continues the completed
2026-09-01 email feature; it does not reopen the financial implementation.

## Confirmed Request

- Use the existing blue/white theme and Arial; all six English/French templates
  share one responsive 600px maximum-width shell, 16px body, and footer text of
  at least 13px. Logo keeps its proportions; images disabled must not hide text.
- Sender: `Leo Mao <notifications@notice.dainty.vip>`.
- Reply-to and internal test destination: `maotiannan@gmail.com`.
- Contact: Leo Mao, phone/WhatsApp `+86 13819858718`.
- Exact WhatsApp destination: `https://wa.me/+8613819858718`.
- Telephone destination: `tel:+8613819858718`; email uses `mailto:`.
- Address: `MU Group, No. 2506, Yongjiang Avenue, Yinzhou District, Ningbo City, Zhejiang Province`.
  Display as three lines: MU Group; street/district; city/province.
- Explain in English/French that the sending address does not accept incoming
  mail and direct customers to the contact section.
- Contact values live in existing email settings, shared by all templates.
  Approved/sent snapshots are immutable.
- Only ADMIN can see/access email management and its APIs. SALES customer-contact
  maintenance permissions remain unchanged.
- Use the existing Resend account through Google login in the user's browser.
  Configure a separate sending subdomain without overwriting existing mail DNS.
- Complete isolated tests and real delivery only to the internal test inbox.
  No artificial production business data, no approval of accumulated customer tasks.
- Push, PR, wait for pre/post-merge CI, then safely deploy and enable sending only
  after all checks. Automatic approval/sending of customer tasks remains excluded.

## Implementation And Evidence

- [x] Fetch latest main; create `feat/email-contact-rollout-20260908` from `18c8c60`.
- [x] Add shared persisted contact settings, validation, HTML/plain footer and UI.
- [x] Reuse full MU Group PNG; no new generated media or dependency.
- [x] Final local Jest: 209 suites / 1398 tests; full ESLint, TypeScript and
  production Webpack build pass. Running production services remain unchanged.
- [x] Isolated API `email-delivery-workflow` passes, including contact persistence
  through approval and unchanged approved content after a settings edit.
- [x] Isolated browser email management: 2 tests pass, including ADMIN approval,
  SALES denial and 1280/390/320px preview overflow checks before final header adjustment.
- [x] Final rendered browser inspection: full PNG logo loads at original aspect
  ratio; mobile 390px layout and French long-name/long-order 320px layout have no
  horizontal overflow; exact phone/WhatsApp/mailto links present, no console errors.
- [x] Google login succeeds; existing `dainty.vip` remains unchanged and verified.
- [x] With user confirmation, created `notice.dainty.vip` in Resend on September 8.
  On September 10 added exactly four DNS records after separate confirmation:
  TXT `resend._domainkey.notice`, TXT/MX `send.notice`, and TXT `_dmarc.notice`
  (`v=DMARC1; p=none;`). Authoritative Cloudflare DNS returns all four correct values;
  Resend verification subsequently completed.
- [x] PR #34 initial CI `34455717364` passed (6m16s). Review found mismatched
  displayed phone/WhatsApp URL possible after partial edits; regression reproduced
  and normalization-based equality validation added before merge.
- [x] Resend shows `notice.dainty.vip` Verified. Scoped sending key created with
  user confirmation; saved outside Git under `~/.muledger-secrets/` with mode 600.
- [x] Production webhook created on September 11 with explicit confirmation,
  endpoint `https://muledger.dainty.vip/api/webhooks/resend`, seven supported events.
  Signing secret saved locally mode 600. Runtime has not loaded credentials yet.
- [ ] Final reviewed-commit and post-merge CI.
- [x] Create/verify sending subdomain and configure scoped key plus webhook.
- [x] Six synthetic samples sent only to the internal test inbox on September 12;
  all six were Delivered in Resend and the user confirmed receipt. This proves
  provider delivery, not production callback processing (credentials were not loaded).
- [x] User approved final mobile width and font hierarchy on September 13 and
  explicitly requested no further sample resend. Narrow-screen Gmail re-delivery
  of this final version is therefore intentionally not performed.
- [ ] Production callback processing verification (do not describe Delivered as callback success).
- [ ] Verify backup, deploy with outbound disabled/test mode enabled, then verify
  production callback/configuration and ensure no test sends remain queued.
- [ ] Enable outbound and disable test mode only after acceptance. Never approve
  existing customer tasks as part of rollout.

## Template Review Follow-up (2026-09-11)

User confirmed: payment notifications display the linked ORDER NO balance after
payment (not the whole invoice balance), INV NO, shipment date and release date.
Read the receipt's persisted order relation and its invoice, require the same
customer, and reuse `computeOrderBalanceFromReceipts`; do not trust cached
`orderBalance` or fall back to OCR invoice text. Unavailable fields render as an
em dash; system pool names are not customer invoice numbers. Pending preview and
approval refresh the current order balance; approved/sent rendered snapshots stay
unchanged. No new financial formula or schema migration.

New default English/French payment templates include these fields. Existing
customized templates remain valid and are not overwritten; optional variables
are available for template editing. Final template selection/approval is complete.
Shipment container number is deferred until the user defines its data
source and matching rule; no placeholder collection or invented container data.

The local six-sample review artifact uses synthetic data only and calls the same
renderer. September 13 approval permits release/deployment, not another resend.

Final layout: Arial, 22px bold blue title, 20px bold amount/balance, 13px muted
labels on their own line, 16px values with bold order/invoice/receipt numbers,
17px contact name, 14px contact links and 13px footer. Mobile uses 4px external
horizontal padding, 12px body wrapper and 14px body padding; desktop spacing is
preserved. HTML styling never changes plain-text content or approved snapshots.

Verification: 1407 tests / 209 suites, full TypeScript and ESLint passed for final
release code; earlier isolated delivery API covers linked invoice/date refresh,
live balance and immutable approved contact snapshots. CI reruns the full isolated
API and browser suites before/after merge.

## Safety And Recovery

No schema migration. All new fields use existing `SystemSetting` rows and are
covered by the full MySQL dump; approved HTML/plain content stays in `EmailDelivery`.
See [backup scope and recovery](../../backup/muledger-local-backup.md) and
[email operations](../../email-notification-operations.md). Credentials stay only
in deployment environment, never Git, database, logs or chat.

If verification fails, leave outbound disabled. For post-enable incidents disable
outbound, pause only the email trigger if needed, and preserve all data/history.
Browser actions requiring just-in-time consent (external submissions, persistent
credentials) must pause at the actual action; other authorized work can continue.
