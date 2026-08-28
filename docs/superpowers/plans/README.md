# Implementation Plan Status Index

> Last reviewed: 2026-08-28

This file is the authoritative status index for historical implementation plans in this directory.

- `ARCHIVED_COMPLETED`: the implementation has landed on `main`; unchecked boxes in the original plan are historical execution notes, not active backlog.
- `ARCHIVED_SUPERSEDED`: the original scope was replaced by a later user-approved approach; do not resume it without a new request.
- `ACTIVE`: currently approved work that still has required implementation steps.

The MU Contract reconcile preview conflict-count correction is currently `ACTIVE`. Historical plans remain archived below.

| Plan | Status | Outcome |
| --- | --- | --- |
| `2026-08-28-mu-contract-reconcile-preview-conflict-count.md` | `ACTIVE` | Correct inactive-history duplicate counting while preserving active-source collision protection. |
| `2026-08-27-receipt-transfer-reversal.md` | `ARCHIVED_COMPLETED` | Transactional transfer reversal shipped in v1.0.213; the verified migration, production deployment, one-time incident repair, postconditions, and idempotent retry all completed. |
| `2026-08-26-dashboard-history-signing-draft-edit.md` | `ARCHIVED_COMPLETED` | Dashboard now shows Recent Receipts before Historical Orders, and unfinished signed-receipt drafts update Receipt plus the pending signing session transactionally. |
| `2026-08-24-dashboard-source-deposit-reconciliation.md` | `ARCHIVED_COMPLETED` | One Dashboard customer dialog, inactive MU Contract source takeover, transactional invoice-write migration, and ADMIN Rematch repair controls shipped on the verified feature branch. |
| `2026-07-19-muledger-nas-local-backup.md` | `ARCHIVED_COMPLETED` | NAS-only daily snapshots, isolated restore, controlled deployment, final verification, and post-enable recovery point completed. |
| `2026-07-18-mucontract-order-sync-muledger.md` | `ARCHIVED_COMPLETED` | Production migration, Full Reconcile, 53 source links, zero-conflict enablement, and idempotent incremental verification completed. |
| `2026-07-18-mucontract-order-sync-source.md` | `ARCHIVED_COMPLETED` | MU Contract producer, migration, historical projection initialization, authenticated feed, and MULEDGER consumption are live. |
| `2026-03-30-invoice-branch-assignment.md` | `ARCHIVED_COMPLETED` | Invoice branch reassignment and customer-owner visibility shipped. |
| `2026-04-27-invoice-rematch-single-customer-reparse.md` | `ARCHIVED_COMPLETED` | Unresolved invoice orders can be reparsed during rematch. |
| `2026-04-27-signed-receipt-generator.md` | `ARCHIVED_COMPLETED` | Signed receipt generation, signing isolation, NAS image persistence, and finalization shipped. |
| `2026-04-28-excel-ml-token-api.md` | `ARCHIVED_COMPLETED` | Account-scoped Excel lookup tokens and batch APIs shipped. |
| `2026-04-28-receipt-generator-template-mobile.md` | `ARCHIVED_COMPLETED` | Approved receipt template and mobile signing flow shipped. |
| `2026-04-30-receipt-direct-upload-hardening.md` | `ARCHIVED_COMPLETED` | Weak-network direct receipt upload hardening shipped. |
| `2026-04-30-uploaded-asset-cleanup.md` | `ARCHIVED_COMPLETED` | Uploaded asset registry and scheduled orphan cleanup shipped. |
| `2026-05-04-receipt-detail-upload-mobile-hardening.md` | `ARCHIVED_COMPLETED` | Shared compression/upload pipeline and mobile layouts shipped. |
| `2026-05-04-receipt-edit-approval.md` | `ARCHIVED_COMPLETED` | SALES receipt edit approval and ADMIN direct editing shipped. |
| `2026-05-05-approval-search-receipt-followups.md` | `ARCHIVED_COMPLETED` | Approval aggregation, search request ordering, and composite ORDER follow-ups shipped. |
| `2026-05-05-detail-swift-edit-approval.md` | `ARCHIVED_COMPLETED` | Payment Detail and SWIFT edit approval flows shipped. |
| `2026-05-05-global-matching-receipt-detail-followups.md` | `ARCHIVED_COMPLETED` | Shared ORDER matching, aliases, receipt balance, and dependent follow-ups shipped. |
| `2026-05-05-workspace-mobile-settings-receipts-invoices.md` | `ARCHIVED_COMPLETED` | Workspace mobile layouts, collapsible settings, receipt filters, and invoice sorting shipped. |
| `2026-05-06-agent-detail-swift-invoice-followups.md` | `ARCHIVED_COMPLETED` | Payment agents, detail relinking/export, SWIFT normalization, and invoice ordering shipped. |
| `2026-05-06-dashboard-detail-swift-ux.md` | `ARCHIVED_COMPLETED` | Dashboard loading independence and Detail/SWIFT UX hardening shipped. |
| `2026-06-08-dashboard-layout-preferences.md` | `ARCHIVED_COMPLETED` | Account-scoped Dashboard card visibility and ordering shipped. |
| `2026-06-28-dashboard-order-receipt-image-preview.md` | `ARCHIVED_COMPLETED` | Dashboard search results can open receipt image previews. |
| `2026-06-28-dashboard-order-receipt-search.md` | `ARCHIVED_COMPLETED` | The ORDER receipt search card shipped and was later upgraded to customer history search. |
| `2026-06-29-detail-swift-status-pagination.md` | `ARCHIVED_COMPLETED` | Detail/SWIFT status filters and account page-size preferences shipped. |
| `2026-06-30-customer-order-history-desktop-layout.md` | `ARCHIVED_COMPLETED` | Customer history desktop sizing and financial-column layout shipped. |
| `2026-06-30-full-receipt-meta-editor.md` | `ARCHIVED_SUPERSEDED` | Full-receipt editing was explicitly narrowed to absolute positioning of `No/Date/Tél`; the broader editor must not be resumed. |
| `2026-06-30-sidebar-receipt-meta-customer-files.md` | `ARCHIVED_COMPLETED` | Fixed sidebar, receipt metadata layout, and customer company files shipped. |
| `2026-07-01-global-pagination-guinea-time.md` | `ARCHIVED_COMPLETED` | Shared compact pagination and Guinea time formatting shipped. |
| `2026-07-01-receipt-global-pagination.md` | `ARCHIVED_COMPLETED` | Receipt Management moved to account-scoped shared pagination. |
| `2026-07-03-customer-order-history-pagination-sorting.md` | `ARCHIVED_COMPLETED` | Customer history sorting and independent pagination shipped. |
| `2026-07-03-dashboard-live-order-balance.md` | `ARCHIVED_COMPLETED` | Dashboard live balance computation and cache self-repair shipped. |
| `2026-07-14-orders-confirmed-date.md` | `ARCHIVED_COMPLETED` | Orders confirmation date persistence and display shipped. |
| `2026-07-15-dashboard-customer-analytics.md` | `ARCHIVED_COMPLETED` | Backend customer analytics and the three-tab Dashboard card shipped. |
| `2026-07-16-dependency-security-remediation.md` | `ARCHIVED_COMPLETED` | Full and production dependency audits were reduced from 24 findings to zero. |

## Maintenance Rule

When a plan is completed or replaced:

1. Update its status banner.
2. Update this index in the same commit.
3. Preserve the original checklist for decision history instead of rewriting it as if every step ran exactly as drafted.
4. Record the actual shipped result in `ENGINEERING_LOG.md`.
