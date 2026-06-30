# Full Receipt Meta Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a standalone full-receipt HTML editor where the current generated receipt is locked and only the `No`, `Date`, and `Tél` labels and values can be positioned.

**Architecture:** Generate the locked background from the real receipt Canvas with its existing meta draw block temporarily hidden, then embed that PNG into a standalone HTML file. Overlay six DOM layers using native receipt coordinates and convert pointer movement through the display zoom so exported coordinates remain absolute.

**Tech Stack:** Existing React Canvas renderer, temporary Next.js preview route, Playwright CLI, standalone HTML/CSS/JavaScript.

## Global Constraints

- Do not commit the rejected partial-stage receipt integration.
- Do not modify the production receipt output before the operator returns a new absolute layout JSON.
- Lock every receipt element except the six meta layers.
- Export absolute coordinates relative to the full `720px` receipt.
- Keep the editor self-contained and usable through `file://`.

---

### Task 1: Restore The Approved Production Receipt Baseline

**Files:**
- Restore: `src/components/workspace/modules/receipts/generator/receipt-canvas.tsx`
- Restore: `src/components/workspace/modules/receipts/generator/receipt-canvas.test.tsx`
- Restore: `src/components/workspace/modules/receipts/generator/template-geometry.ts`
- Restore: `src/components/workspace/modules/receipts/generator/template-geometry.test.ts`
- Restore: `tools/receipt-meta-layout-editor.html`
- Restore: `docs/superpowers/plans/2026-06-30-sidebar-receipt-meta-customer-files.md`

**Interfaces:**
- Produces: the exact production source from commit `bc8d5b0` while preserving this plan and the approved design spec.

- [ ] Manually apply the reverse diff for all rejected uncommitted changes.
- [ ] Run:

```bash
npx jest \
  src/components/workspace/modules/receipts/generator/template-geometry.test.ts \
  src/components/workspace/modules/receipts/generator/receipt-canvas.test.tsx \
  --runInBand \
  --testPathIgnorePatterns='/node_modules/' '/.next/' '/tests/e2e/'
```

- [ ] Confirm 2 suites and the original 8 tests pass.

---

### Task 2: Generate A Locked Background From The Real Canvas

**Files:**
- Temporarily modify, then restore: `src/components/workspace/modules/receipts/generator/receipt-canvas.tsx`
- Temporarily create, then delete: `src/app/receipt-layout-preview-test/page.tsx`
- Generate temporarily: `output/playwright/receipt-meta-editor-background.png`

**Interfaces:**
- Produces: a PNG from the current Canvas with the entire receipt visible and the six meta texts omitted.

- [ ] Save a temporary copy of `receipt-canvas.tsx`.
- [ ] Temporarily skip only the existing `No`, receipt number, `Date`, date value, `Tél`, and phone draw calls.
- [ ] Create a sample route that renders `ReceiptCanvas` with fixed non-business sample data.
- [ ] Build the route with a non-connecting placeholder `DATABASE_URL`.
- [ ] Start the built app on port `3101`.
- [ ] Use Playwright to screenshot only `[data-testid="receipt-preview-canvas"]`.
- [ ] Restore `receipt-canvas.tsx` from the temporary copy and delete the preview route.
- [ ] Confirm `git diff -- src/components/.../receipt-canvas.tsx` contains no background-generation edits.

---

### Task 3: Build The Standalone Full Receipt Editor

**Files:**
- Create: `tools/receipt-full-meta-layout-editor.html`

**Interfaces:**
- Consumes: embedded base64 PNG from Task 2.
- Produces: `RECEIPT_META_ABSOLUTE_LAYOUT` JSON with native `720px` coordinates.

- [ ] Create a locked stage containing the embedded full receipt background.
- [ ] Add exactly six draggable/resizable layers:

```js
const defaultLayout = {
  schema: 'RECEIPT_META_ABSOLUTE_LAYOUT',
  version: 1,
  stage: { width: 720, height: BACKGROUND_HEIGHT },
  layers: {
    receiptNoLabel: { x: 0, y: 0, w: 34, h: 18, fontSize: 14, fontWeight: 400, text: 'No:' },
    receiptNoValue: { x: 0, y: 0, w: 92, h: 24, fontSize: 18, fontWeight: 400, text: '0010000' },
    dateLabel: { x: 0, y: 0, w: 42, h: 18, fontSize: 14, fontWeight: 400, text: 'Date:' },
    dateValue: { x: 0, y: 0, w: 95, h: 22, fontSize: 14, fontWeight: 400, text: '30/06/2026' },
    telLabel: { x: 0, y: 0, w: 32, h: 18, fontSize: 14, fontWeight: 400, text: 'Tél:' },
    telValue: { x: 0, y: 0, w: 187, h: 22, fontSize: 14, fontWeight: 400, text: '+224 622 05 71 47' },
  },
};
```

- [ ] Initialize visible coordinates near the existing right-header area without changing the locked background.
- [ ] Convert pointer deltas by the current display scale before updating native coordinates.
- [ ] Add layer selection, numeric controls, zoom, Reset, Import JSON, Export JSON, and Copy.
- [ ] Clamp layers inside the native stage.
- [ ] Keep the receipt number orange and all other meta layers in the current receipt ink color.

---

### Task 4: Browser Verification And Delivery

**Files:**
- Verify: `tools/receipt-full-meta-layout-editor.html`
- Update: `docs/superpowers/plans/2026-06-30-sidebar-receipt-meta-customer-files.md`

**Interfaces:**
- Produces: a committed editor ready for the operator to open and return JSON.

- [ ] Open the editor directly using `file://` in Playwright.
- [ ] Verify the complete locked receipt background loads.
- [ ] Verify exactly six editable layers exist.
- [ ] Drag one layer and confirm its exported `x/y` changes in native coordinates.
- [ ] Change zoom and confirm exported coordinates do not change.
- [ ] Export, import, and export again; require identical JSON.
- [ ] Capture a screenshot of the complete editor.
- [ ] Remove browser artifacts and generated background files that are already embedded.
- [ ] Run `git diff --check`.
- [ ] Commit the editor and docs; do not push or rebuild Docker until the operator approves the exported layout.

---

### Task 5: Integrate The Approved Absolute Layout

**Files:**
- Modify: `src/components/workspace/modules/receipts/generator/template-geometry.ts`
- Modify: `src/components/workspace/modules/receipts/generator/template-geometry.test.ts`
- Modify: `src/components/workspace/modules/receipts/generator/receipt-canvas.tsx`
- Modify: `src/components/workspace/modules/receipts/generator/receipt-canvas.test.tsx`
- Modify: `tools/receipt-full-meta-layout-editor.html`

**Interfaces:**
- Consumes: the operator-approved `RECEIPT_META_ABSOLUTE_LAYOUT`.
- Produces: identical No/Date/Tél placement in preview and exported PNG.

- [x] Freeze the approved six-layer JSON in template geometry.
- [x] Draw labels and dynamic values as separate absolute Canvas layers.
- [x] Keep telephone text on one line and shrink it when necessary.
- [x] Preserve all non-meta receipt geometry.
- [x] Synchronize the editor defaults with the approved production layout.
- [x] Run focused tests, full project checks, and visual sample verification.
