# Email Contact Layout And Production Activation

Status: ACTIVE. Production outbound delivery must remain disabled until real
delivery and callback verification pass. This plan continues the completed
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
- [x] Google login succeeds; existing `dainty.vip` is verified. Prepared but did not
  submit `notice.dainty.vip` creation. No DNS changes or Resend keys created.
- [ ] PR and CI (deferred while domain registration awaits action-time consent).
- [ ] Create/verify sending subdomain and configure scoped key plus webhook.
- [ ] Preview all six templates and verify internal real delivery and callback.
- [ ] Verify backup, deploy with outbound disabled/test mode enabled, then verify
  production callback/configuration and ensure no test sends remain queued.
- [ ] Enable outbound and disable test mode only after acceptance. Never approve
  existing customer tasks as part of rollout.

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
