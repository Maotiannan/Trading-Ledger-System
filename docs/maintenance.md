# Maintenance register

Development entry points: [AGENTS](../AGENTS.md), [change checklist](../CHANGE_CHECKLIST.md), [API testing](API_TESTING.md), [storage and recovery](backup/muledger-local-backup.md). Git history and release records describe what shipped; unchecked boxes in old execution plans are not a live backlog.

| Retired material | Current home |
| --- | --- |
| 44 implementation plans, their status index and 32 design specs | Feature code, tests, README and the corresponding integration/operations contract. The superseded whole-receipt layout proposal is not an approved feature. |
| 10 dated migration/restore receipts | [Backup history and current checks](backup/archive/README.md). Do not run historical incident commands on a live database. |
| Development work log, milestone list and engineering log | Git history for completed work; remaining items below. The short Claude entry is retained because it directs tools to AGENTS. |

For the original documents, use the immutable tree at commit `58fe4def6a5e07574947543b83051ebead53892a` or the local archive tag `archive/muledger-pre-doc-consolidation-20261127`. For example: `git show 58fe4de:docs/superpowers/plans/README.md`. New routine changes update the relevant maintained document, not a dated plan or changelog mirror.

**Unfinished work, not automatic authorization:** evaluate notifications for deletion/abnormal amounts/signing, richer reports/CSV and batch customer repair. Engineering follow-ups: selected service splits on the next relevant change, development dependency alerts, safe default-deny design for integrations, history archival/query performance, observability (Sentry or Prometheus/Grafana were proposals), API documentation, troubleshooting and i18n rules. Check current implementation and priorities before opening work. Channel-specific delivery/verification gates are in the [email](email-notification-operations.md) and [WhatsApp](whatsapp-notification-operations.md) manuals.
