# Dashboard / Payment Detail / SWIFT UX Hardening Design

**Date:** 2026-05-06  
**Status:** Proposed  
**Scope:** Dashboard data loading, payment detail export rendering, detail/swift mobile dialogs, SWIFT OCR mapping and confirm-create reliability

---

## 1. Background

Recent production feedback exposed six related problems:

1. `Dashboard` and `SWIFT -> Upload SWIFT -> Select Payment Detail` depend on other modules being opened first before useful data appears.
2. `Payment Detail -> Export Pic` renders unreadable square glyphs instead of the intended handwritten-like payment details layout.
3. `Edit Payment Detail` exposes raw internal IDs such as `cmosdqc3d001boz01r0hw70tx`, which are meaningless to business users.
4. `Edit Payment Detail` on mobile pushes footer actions outside the viewport.
5. `Upload SWIFT Record` OCR currently confuses bank-header identifiers with business sender/receiver fields and confirm-create can fail with `Invalid input: expected number, received NaN`.
6. `Upload SWIFT Record` on mobile also pushes footer actions outside the viewport.

These are not independent UI bugs. They reveal three underlying gaps:
- data loading is page-coupled instead of dependency-driven,
- export rendering is still hardcoded instead of template-driven,
- OCR/edit dialogs are not using a consistent mobile interaction shell.

---

## 2. Goals

1. Make `Dashboard` and `SWIFT` upload flows load the data they actually need without requiring users to visit unrelated pages first.
2. Replace `Payment Detail` export rendering with a template-backed HTML-to-image pipeline that matches the provided `payment_details.html` reference.
3. Remove raw internal IDs from `Payment Detail` edit UI or replace them with human-readable context.
4. Make `Detail` and `SWIFT` dialogs fully usable on narrow mobile viewports with sticky footer actions.
5. Change `SWIFT OCR` extraction to prefer Block 4 business fields:
   - `:50K:` first line -> sender name
   - `:50K:` subsequent lines -> sender address
   - `:59:` first line(s) -> receiver account / receiver name
6. Fix `SWIFT confirm create` so empty/partial OCR edits do not propagate `NaN` into validation.

---

## 3. Non-Goals

1. No redesign of the entire dashboard page layout beyond data loading and minor presentation alignment.
2. No replacement of the existing OCR provider.
3. No generalized document-templating framework for arbitrary exports; this change only templates payment detail export.
4. No cross-module cache invalidation redesign beyond what is needed to solve the observed stale-loading behavior.

---

## 4. User-Facing Behavior

### 4.1 Dashboard

- Opening `/dashboard` should show receipt/detail/swift summary cards immediately after its own load path completes.
- Dashboard must not rely on the user first opening `Payment Detail`, `SWIFT`, or any other module.
- This must not regress first-load performance by fetching every workspace dataset globally.

### 4.2 SWIFT Upload Dialog

- Opening `Upload SWIFT Record` should populate `Select Payment Detail` from a dialog-local fetch of eligible details.
- The select should not depend on the `Payment Detail` page having been visited.
- OCR fields shown in the dialog must include:
  - amount
  - transfer date
  - sender name
  - sender address
  - receiver name
  - receiver account
- The dialog must be usable on mobile with a scrollable content body and sticky `Cancel / Confirm Create` footer.

### 4.3 Payment Detail Export Pic

- Any visible payment detail row, regardless of source mode or status, can export a picture.
- The exported image must be derived from the provided `payment_details.html` template.
- Export format should be JPG.
- The rendered text must use a font pipeline that avoids the current “small square glyphs” failure.

### 4.4 Edit Payment Detail Dialog

- Business users must not see raw internal IDs.
- If a linked receipt reference is needed, it should be shown using human-readable context such as receipt number / order number / amount summary.
- On mobile, the dialog body may scroll, but footer actions must remain reachable without horizontal panning.

---

## 5. Architecture

### 5.1 Minimal Dependency Loading

Introduce module-specific dependency fetches instead of relying on shared store warm-up:

- `Dashboard` gets a dedicated read path for the summary and recent rows it actually displays.
- `SWIFT` upload dialog gets a dedicated fetch for selectable `Payment Detail` records.

This keeps the current workspace model intact:
- global store still exists for module pages,
- but pages/dialogs that have independent data prerequisites can fetch them directly.

This is preferred over global preloading because it preserves startup performance and removes accidental inter-page coupling.

### 5.2 Template-Driven Payment Detail Export

Replace the current SVG-only export builder with an HTML-template-driven render pipeline.

Proposed flow:
1. Load `payment_details.html` as a frozen export template.
2. Inject normalized detail data into template placeholders.
3. Render HTML to an image in a deterministic server-side path.
4. Export as JPG.

The template is treated as a product artifact, not a live editor. We copy its final layout semantics into the app and keep the file as the canonical source for this export shape.

### 5.3 SWIFT OCR Field Mapping

The current OCR path mixes two different concepts:
- SWIFT header sender/receiver BIC identifiers,
- Block 4 business sender/receiver information.

We will explicitly separate them and use **business** fields for the UI payload:
- `:50K:` block -> sender business identity
- `:59:` block -> receiver business identity and receiver account

Header `Sender` / `Receiver` values will no longer be used to populate business form fields.

### 5.4 Shared Mobile Dialog Shell

`Detail` and `SWIFT` dialogs will share the same mobile dialog interaction model:
- constrained max viewport height,
- scrollable body,
- sticky footer,
- no hidden primary action below the fold.

This is not a new component framework, but the structure and CSS pattern should be consistent so future OCR/edit dialogs can reuse it.

---

## 6. Data Model and API Changes

### 6.1 Dashboard Read Path

Add a dedicated read endpoint or server-side action that returns only dashboard needs:
- current summary counts/totals,
- recent receipts,
- recent details.

It should not eagerly return the full invoice/receipt/detail/swift tables.

### 6.2 SWIFT Upload Dependency Read Path

Expose a small endpoint or action for dialog-local `Payment Detail` selection:
- only details eligible for SWIFT creation,
- already filtered by current user visibility,
- shaped for select options and dialog context.

### 6.3 SWIFT OCR Result Shape

The OCR result object should be expanded and normalized to:
- `amount: number | null`
- `date: string | null`
- `senderName: string | null`
- `senderAddress: string | null`
- `receiverName: string | null`
- `receiverAccount: string | null`

Confirm-create validation must coerce empty numeric inputs safely and reject invalid numbers with a domain error, not a `NaN` schema failure.

### 6.4 Payment Detail Export Endpoint

The existing `export-pic` action remains, but the rendering backend changes from SVG generation to template-backed JPG generation.

---

## 7. Detailed Behavior Rules

### 7.1 Dashboard Loading

- `Dashboard` should request its own summary payload on mount.
- If cached data exists, it may render immediately, but the page must not wait on unrelated module pages.
- If summary fetch fails, show a dashboard-local error state; do not poison the global store.

### 7.2 SWIFT Select Payment Detail Loading

- When `Upload SWIFT Record` opens, fetch eligible details if none are already present in local dialog state.
- Cache the result for the current session to avoid repeated network hits while the dialog is reopened.
- If the fetch fails, surface a clear dialog error instead of leaving the select empty with no explanation.

### 7.3 SWIFT OCR Parsing Rules

From the sample SWIFT image and user-confirmed requirements:

- Header section values such as:
  - `Sender: UNAFLRLMXXX`
  - `Receiver: CITIUS33XXX`
  are treated as transport/bank identifiers and **must not** populate the business sender/receiver name fields.

- Block 4 parsing rules:
  - `:50K:` line content and following address lines populate:
    - `senderName`
    - `senderAddress`
  - `:59:` block populates:
    - `receiverAccount`
    - `receiverName`
  - OCR parser should preserve multiline semantics internally, then flatten to display-safe strings for the dialog.

### 7.4 SWIFT Confirm Validation

- Empty string values in numeric inputs must not become `NaN`.
- Confirmation path should normalize numeric fields before schema parsing.
- If amount is missing/invalid, return a business validation error such as “Amount is required” instead of surfacing low-level schema text.

### 7.5 Payment Detail Edit Dialog

For `receiptId` references in editable items:
- do not show raw database IDs to users,
- show a readable label derived from the linked receipt, if available,
- if no readable label can be derived, hide the field rather than exposing the raw ID string.

### 7.6 Mobile Dialog Layout

Both dialogs (`DetailUploadDialog`, `SwiftUploadDialog`) and the edit dialog should follow:
- `DialogContent` capped by viewport height,
- scroll only inside content body,
- sticky footer with visible actions,
- no action button outside the viewport in narrow portrait mode.

---

## 8. Files Likely to Change

### UI / Hooks
- `src/components/workspace/modules/dashboard/dashboard-view.tsx`
- `src/components/workspace/modules/details/detail-manager.tsx`
- `src/components/workspace/modules/details/components/detail-edit-dialog.tsx`
- `src/components/workspace/modules/details/components/detail-upload-dialog.tsx`
- `src/components/workspace/modules/details/hooks/use-detail-actions.ts`
- `src/components/workspace/modules/swifts/swift-manager.tsx`
- `src/components/workspace/modules/swifts/components/swift-upload-dialog.tsx`
- `src/components/workspace/modules/swifts/hooks/use-swift-actions.ts`
- `src/components/workspace/modules/swifts/types.ts`

### Server / Services
- `src/app/api/detail/route.ts`
- `src/app/api/swift/route.ts`
- `src/lib/detail-export-image.ts`
- `src/lib/ocr-input.ts`
- `src/lib/swift-service.ts`
- `src/lib/report-service.ts` only if shared rendering utilities are reused

### Templates / Assets
- add a frozen payment detail export template derived from:
  - `payment_details.html`

### Tests
- `src/app/api/detail/route.test.ts`
- `src/app/api/swift/route.test.ts`
- `src/components/workspace/modules/details/hooks/use-detail-actions.test.tsx`
- `src/components/workspace/modules/swifts/hooks/use-swift-actions.test.tsx`
- add dialog layout tests where practical
- add or update isolated API cases for SWIFT OCR confirm/create

---

## 9. Testing Strategy

### Automated API / Service

1. Dashboard summary endpoint returns required aggregates without requiring other pages.
2. SWIFT selectable details endpoint returns visible eligible detail rows.
3. SWIFT OCR confirm handles missing/edited amount without producing `NaN` schema failure.
4. SWIFT OCR mapping uses Block 4 business fields, not header BIC values.
5. Payment detail export endpoint returns JPG with non-empty rendered content.

### Frontend / Hook

1. `DetailUploadDialog` mobile/sticky footer behavior.
2. `SwiftUploadDialog` mobile/sticky footer behavior.
3. `DetailEditDialog` no raw internal ID leakage.
4. `useSwiftActions` recovers cleanly from OCR and confirm errors.

### End-to-End

1. Open `Upload SWIFT Record` before visiting `Payment Detail` and verify the detail select is populated.
2. Run SWIFT upload flow with sample-like OCR response and confirm business fields are placed correctly.
3. Export `Payment Detail` picture and verify a download occurs with JPG output.

---

## 10. Risks and Mitigations

### Risk: Template rendering drift
Mitigation:
- keep the payment detail export template isolated and snapshot-test the generated HTML/image output.

### Risk: OCR parser overfits one sample
Mitigation:
- implement field extraction around stable SWIFT markers (`:50K:`, `:59:`) rather than absolute positions,
- keep header parsing separate and explicit.

### Risk: Dashboard payload duplication
Mitigation:
- return only dashboard-facing aggregates/recent rows,
- do not mirror full module payloads into the dashboard endpoint.

### Risk: Mobile dialog fixes regress desktop
Mitigation:
- keep desktop sizing intact and only alter overflow/sticky structure below mobile breakpoints.

---

## 11. Rollout Order

1. P0 hotfix: SWIFT confirm-create `NaN` failure.
2. Mobile dialog fixes for `Detail` and `SWIFT`.
3. Dialog-local loading for selectable details and dashboard summary path.
4. Payment detail export template pipeline.
5. SWIFT OCR Block 4 mapping and expanded dialog fields.

This order restores broken workflows first, then fixes correctness, then improves presentation.
