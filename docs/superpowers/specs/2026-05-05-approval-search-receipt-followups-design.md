# Approval, Search, and Composite ORDER Follow-ups Design

## Scope
This spec covers four follow-up changes:
1. Composite ORDER matching using `/` segments without bulk auto-migrating data.
2. Merge deletion approval and edit approvals into one Approval page.
3. Generalize Payment Detail `Export Pic` to all details.
4. Rebuild list search behavior so live search stays responsive without stale/wrong final results.

## Requirements

### 1. Composite ORDER matching
- Do not auto-rewrite existing database rows in this change.
- Support `ORDER NO` values that contain `/` as a list of equivalent order fragments for exact-order lookup.
- If any segment matches under normal rules, return the entire owning record.
- Continue to support existing ignore-space normalization and customer alias matching.
- Manual data cleanup remains user-owned; this implementation only changes matching semantics.

### 2. Approval page aggregation
- Keep existing `/deletions` route to avoid route churn, but rename the page and sidebar label from `Deletion Approval` to `Approval`.
- Move the currently embedded `Receipt Edit Requests`, `Payment Detail Edit Requests`, and `SWIFT Edit Requests` sections out of their module pages into the Approval page.
- Approval page shows separate sections/cards for:
  - Deletion Requests
  - Receipt Edit Requests
  - Payment Detail Edit Requests
  - SWIFT Edit Requests
- Preserve existing permissions:
  - SALES can see their own edit requests.
  - ADMIN can see and review higher-scope requests they are allowed to approve.
  - Deletion request behavior stays unchanged.

### 3. Detail Export Pic generalized
- Remove the `sourceMode === DIRECT` gate.
- Any visible Payment Detail record, regardless of status or source mode, can export a rendered PNG.
- Existing export format stays the same structured style already implemented.

### 4. Search rebuild
- Root problem is stale async responses overwriting newer search results.
- Introduce one shared request-guard/search utility for live list pages.
- All list pages should ignore stale responses and only apply the latest request result.
- Keep live-as-you-type feel; do not regress to manual submit.
- Normalize search input consistently before dispatch.
- Preserve existing server-side search matching behavior for now unless needed by route-specific filters.

## Design

### Composite ORDER kernel changes
- Extend the order-name kernel with a parser for `/`-delimited composite order numbers.
- For an input like `PIKIN-23/PIKIN-19C`, generate ordered candidates:
  - full raw string
  - each `/` segment
  - each segment's derived left-of-final-dash prefix when relevant
- Reuse this in exact order-context lookup and related matching entry points.
- Do not treat space as a new multi-order delimiter in matching logic; only `/` gains this semantics.

### Approval page architecture
- Deletion manager becomes Approval manager in presentation only.
- Add three loaders into the approval page for edit request data.
- Reuse existing actions/services/APIs instead of creating new approval endpoints.
- Remove duplicate request tables from Receipt/Detail/SWIFT module pages after confirming the centralized page renders the same data/actions.

### Detail export behavior
- API `GET /api/detail?action=export-pic&detailId=...` drops direct-only restriction.
- Rendering helper remains shared and stateless.
- UI button is shown for any visible detail row.

### Search stabilization
- Add a shared latest-request gate that gives each load cycle a monotonically increasing token.
- A response only mutates UI state if its token is still current.
- Apply to invoice, receipt, detail, swift, customer, settings audit/export history, deletion approval, and any other page currently issuing live fetches from input changes.
- This avoids stale broad results replacing the final narrower query result.

## Testing
- Unit tests for composite-order candidate expansion.
- API/service regression for `/` segment matching in order-context lookup.
- UI/API tests for Approval page sections and removal from old pages.
- API route test for detail export without source-mode restriction.
- Search regression tests proving older request responses are ignored when newer search input finishes later.

## Out of scope
- Bulk auto-migration of old multi-order strings to `/`.
- Changing route pathname from `/deletions`.
- Rewriting server search semantics beyond what is needed for correctness/stale suppression.
