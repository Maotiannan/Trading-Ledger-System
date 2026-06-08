# Dashboard Layout Preferences Design

Date: 2026-06-08
Project: Trading Ledger System / MU Ledger
Status: approved design option B, pending implementation plan

## Goal

Allow every logged-in account to control its own Dashboard card visibility and order without affecting other accounts.

The feature applies to the current eight Dashboard cards and must stay extensible for future cards:

- Invoice Balance
- Pending Receipts
- Waiting SWIFT
- Pending Approvals
- Released Unpaid Invoices
- Customer Outstanding Ranking
- Recent Receipts
- Recent Payment Details

## User-Confirmed Decisions

- Store settings per account, not globally.
- Use option B: extend the existing `UserPreference` model with a Dashboard layout JSON field.
- New accounts or accounts without saved Dashboard settings use the current default Dashboard layout.
- Dashboard uses sortable sections and sortable cards inside each section.
- Section order and card order are both configurable.
- Card hide control is a low-visibility `x` shown on each card by default.
- Clicking `x` requires confirmation:
  - Chinese: `是否隐藏此卡片？隐藏后可在设置中恢复。`
  - English: `Hide this card? You can restore it in Settings.`
- Hidden cards are restorable in Settings.
- Restored cards return to the end of their owning section.
- If all cards in a section are hidden, Dashboard hides the whole section.
- All logged-in roles can change their own Dashboard layout: USER, SALES, ADMIN, ROOT.

## Default Dashboard Structure

The default layout keeps the current visual structure.

### Summary Section

Small KPI cards:

1. `invoice-balance`
2. `pending-receipts`
3. `waiting-swift`
4. `pending-approvals`

### Analysis Section

Table-style cards:

1. `released-unpaid-invoices`
2. `customer-outstanding-ranking`

### Recent Section

Recent activity cards:

1. `recent-receipts`
2. `recent-payment-details`

## Architecture

### Card Registry

Create a single Dashboard card registry in frontend code. Each registered card should define:

- stable card ID
- owning section ID
- default order
- localized label
- render function/component
- optional card size/layout metadata

This prevents card IDs from being scattered across Dashboard and Settings. Future Dashboard cards should be added through this registry.

### Section Registry

Create a Dashboard section registry with:

- stable section ID
- default order
- localized label
- layout class or layout type

The current three sections remain visually distinct because they have different card sizes and grid layouts.

### User Preference Storage

Extend `UserPreference` with a JSON field, recommended name:

```text
dashboardLayout Json?
```

Expected normalized shape:

```json
{
  "sections": [
    {
      "id": "summary",
      "visible": true,
      "cards": [
        { "id": "invoice-balance", "visible": true },
        { "id": "pending-receipts", "visible": true }
      ]
    }
  ]
}
```

Implementation should normalize this shape on read:

- Missing preference row uses default layout.
- Missing section IDs are appended from defaults.
- Missing card IDs are appended to their default section.
- Unknown section IDs or card IDs are ignored or rejected during save.
- Duplicate IDs are removed.
- Empty sections are allowed in preferences, but hidden in Dashboard when no visible cards remain.

## API Design

Use the existing settings user-preferences API path:

- `GET /api/settings?view=user-preferences`
- `POST /api/settings` with `action: "update-user-preferences"`

GET should return both existing image compression preferences and new Dashboard preferences.

POST should allow updating Dashboard layout together with or separately from image compression preferences.

Validation requirements:

- Only authenticated users can read/update their own preference.
- Saved Dashboard layout must only include registered section IDs and card IDs.
- A card must remain in its registered owning section. Cross-section moves are not allowed unless a future design explicitly supports it.
- Section order can change.
- Card order within section can change.
- Card visibility can change.

## Dashboard UI Behavior

Dashboard rendering should read normalized preferences and render only visible sections/cards.

Each card gets a subtle `x` button in the top-right corner. The button should not dominate the UI, but must remain usable on desktop and mobile.

Hide flow:

1. User clicks card `x`.
2. Browser confirmation dialog or project dialog appears with localized text.
3. On confirm, frontend updates the Dashboard preference through API.
4. Dashboard re-renders without that card.
5. If the section has no visible cards, the section disappears.

Failure behavior:

- If save fails, keep the card visible and show a human-readable localized error.
- Do not optimistically remove permanently without server confirmation unless rollback is implemented.

## Settings UI Behavior

Add a new collapsible Settings section:

- Chinese title: `Dashboard 设置`
- English title: `Dashboard Settings`

Inside the section:

- Show each Dashboard section in current saved order.
- Each section has Up/Down controls.
- Show cards under each section in current saved order.
- Each card has Up/Down controls.
- Each card has a visibility switch.
- Hidden cards remain visible inside Settings so they can be restored.
- Restoring a hidden card puts it at the end of its registered section.

Use buttons instead of drag-and-drop for reliability and mobile compatibility.

## Data Migration And Backup Considerations

This change adds persistent account-level settings. It should include a Prisma migration that only adds a nullable JSON field to `UserPreference`.

Implementation must update the project backup documentation because the persisted data model changes. For MU Ledger, check and update:

- `docs/backup/muledger-cos-backup.md`

The backup scope should continue to include the MySQL `trading_ledger` database dump. No media/NAS path change is expected for this feature.

## Tests

Add or update automated tests for:

- default Dashboard layout when no preference exists
- loading stored Dashboard preference
- normalizing missing future card IDs into the default section
- rejecting or filtering unknown section/card IDs
- hiding a card through API and keeping the setting account-scoped
- restoring a card at the end of its section
- changing section order through Settings logic
- changing card order through Settings logic
- Dashboard hiding empty sections
- localized hide confirmation text presence in component behavior

Preferred verification is API/component tests, not manual-only testing.

## Non-Goals

- No drag-and-drop sorting in this version.
- No admin-managed default Dashboard template in this version.
- No cross-section card moves in this version.
- No role-based Dashboard layout enforcement in this version.
- No Docker rebuild in the design stage.

## Implementation Notes

Keep the code modular:

- Dashboard registry should be independent from the Dashboard render component.
- Preference normalization should be a pure function with direct unit tests.
- Settings UI should call the same normalization helpers or consume already-normalized API output.
- Avoid writing card IDs as duplicated string literals across multiple files.
