# Workspace Mobile / Settings / Receipts / Invoices Design

## Scope

This spec covers four coordinated changes:

1. Review and improve mobile browser readability/usability across eight workspace pages:
   - Dashboard
   - Invoice Management
   - Receipt Management
   - Payment Detail
   - SWIFT
   - Customer Management
   - Approval
   - Settings
2. Refactor Settings so each major capability is placed in a collapsible section and only expanded when needed.
3. Upgrade Receipt Management status filtering to multi-select, with pagination defaults and options.
4. Change default Invoice Management ordering so fully collected invoices sink to the end, while preserving ship-date ordering rules.

`User Management` is not treated as a separate ninth page. It remains part of `Settings` and is included through Settings page mobile/collapsible work.

## Goals

- Make the eight workspace pages usable on mobile browsers without horizontal dragging for primary actions and key filters.
- Reduce visual overload on Settings by collapsing advanced sections.
- Improve Receipt Management filtering and paging so the default view focuses on unfinished receipts.
- Make Invoice Management default ordering better reflect operational priority.

## Non-Goals

- No route changes.
- No permission model changes.
- No changes to backend business rules except where pagination/filter input shape must expand.
- No re-theme or large visual redesign outside mobile usability and collapsible layout.

## Design

### 1. Mobile review and remediation across eight pages

A targeted review will be performed for the eight pages listed above. The implementation will prefer focused responsive fixes over broad layout rewrites.

Common remediation patterns:
- Convert toolbar rows that currently assume desktop width into wrapping stacks on small screens.
- Ensure key actions remain visible without horizontal page drag.
- Prefer `grid-cols-1` / stacked cards on narrow viewports, with progressive enhancement back to multi-column on tablet/desktop.
- Ensure long tables are either wrapped into cards where reasonable or placed inside explicit horizontal scroll containers rather than causing whole-page overflow.
- Keep search/filter/action controls grouped logically on mobile.

Expected page-specific focus:
- Dashboard: responsive stats and export actions.
- Invoice Management: toolbar, search card, invoice header metadata, per-invoice action cluster.
- Receipt Management: toolbar, filters, list controls, pagination.
- Payment Detail / SWIFT / Approval: filter bars, action placement, wide-table containment.
- Customer Management: tabs, toolbar, search/import/create actions, long text readability.
- Settings: convert each capability card into collapsible sections.

### 2. Settings collapsible sections

Settings will remain a single page, but each major feature block will become collapsible.

Initial collapsible sections:
- Password Settings
- Excel Token
- User Image Compression
- User Management
- Branch Purge
- System Config
- Settings Audit

Behavior:
- Sections are collapsed by default except the topmost, most frequently used section(s).
- Section header shows title and a disclosure control.
- Expanding one section does not collapse others automatically.
- The expanded/collapsed state is client-side UI state only; no persistence is required in this change.

### 3. Receipt Management status multi-select + pagination

#### Status filtering
Receipt status filter will become multi-select.

Statuses:
- `SIGNING_PENDING`
- `SR_Received`
- `Waiting_SWIFT`
- `Bank_Transfer`
- `RECEIVED`

Default selection on first load:
- selected: `SIGNING_PENDING`, `SR_Received`, `Waiting_SWIFT`, `Bank_Transfer`
- unselected: `RECEIVED`

Meaning:
- default page opens focused on unfinished receipts
- users can explicitly include `RECEIVED`

Implementation approach:
- Use a multi-select checkbox/dropdown pattern in the page UI.
- Backend API query shape expands from a single `status` to repeated or serialized multi-value status input.
- Existing single-status behavior remains backward-compatible where practical.

#### Pagination
Receipt page default page size becomes `30`.
Available page sizes:
- `30`
- `50`
- `100`
- `200`

Behavior:
- Pagination is computed from filtered results, not the raw store.
- Changing page size resets to page 1.
- Filter changes reset to page 1.

### 4. Invoice Management default ordering

Invoices are split into two groups:
- active group: `outstanding > 0`
- completed group: `outstanding = 0`

Group order:
1. active group first
2. completed group second

Within each group:
- invoices with empty `shipDate` appear first
- then invoices with `shipDate`, sorted from earliest to latest

This preserves the user-approved rule that `shipDate`-empty invoices should be at the top of each group, while fully collected invoices still sink below all active invoices.

Sorting is applied to the list shown in Invoice Management only; it does not mutate stored data.

## Data / API impact

### Receipt API
- Accept multiple statuses in list queries.
- Preserve compatibility for existing single-status callers if they still send one value.

### Settings
- No backend data model change required for collapsible UI.

### Invoice list ordering
- No backend contract change required if ordering is performed client-side after fetch.
- If current implementation already centralizes invoice list shaping in a view hook, the sort should be placed there for consistency.

## Error handling

- If multi-status parsing fails, fall back to no status filter rather than crash the page.
- UI collapse state failures must not block settings content rendering.
- Mobile layout fixes must degrade gracefully on desktop.

## Testing

### Unit / component
- Receipt status multi-select defaults and serialization.
- Receipt page size reset behavior.
- Invoice ordering rules including:
  - active before completed
  - null shipDate first within group
  - ascending shipDate after nulls
- Settings collapsible open/close behavior.

### API
- Receipt list endpoint with multiple statuses.
- Receipt list endpoint with a single status (backward compatibility).

### E2E / UI
- Mobile viewport smoke checks for the eight pages.
- Receipt Management mobile toolbar/filter usability.
- Settings collapsible interaction.
- Invoice ordering visible in rendered list.

## Risks and constraints

- Approval, detail, and swift pages contain dense tables; some areas may still require explicit internal horizontal scroll instead of full card conversion in this iteration.
- Receipt multi-select must not regress existing receipt loading or pagination.
- Invoice ordering should be deterministic even when dates are missing or malformed.
