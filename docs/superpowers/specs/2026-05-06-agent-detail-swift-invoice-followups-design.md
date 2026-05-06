# Agent / Detail / SWIFT / Invoice Follow-Ups Design

**Date:** 2026-05-06  
**Status:** Proposed  
**Scope:** payment agent master data, payment detail edit relinking, payment detail export template, SWIFT OCR normalization and messaging, invoice priority ordering

---

## 1. Background

Recent production feedback exposed a second layer of problems after the earlier detail/SWIFT UX hardening work:

1. `SWIFT` validation failures still surface technical or misleading messages, especially in English.
2. `Invoice Management` ordering needs business priority handling for `deposit pool` and `未匹配池`.
3. `Edit Payment Detail` still exposes inconsistent linked-receipt labels, loses cursor position while editing `ORDER NO`, and does not re-run receipt/customer matching semantics after the order number changes.
4. `Upload SWIFT Record` needs stricter field normalization, especially for receiver account values extracted from OCR.
5. `Payment Detail -> Export Pic` is still not a faithful business export. The current image is visually wrong and semantically incomplete.
6. `Payment Detail` needs a new business object, `AGENT`, with scoped visibility, attachments on NAS, and required selection before OCR-confirmed create.

These are related. They all depend on stronger central abstractions:
- a user-facing error message layer,
- a formal `PaymentAgent` master-data model,
- a transaction-safe detail relinking pipeline,
- a template-backed export renderer,
- and a SWIFT OCR normalization layer.

---

## 2. Goals

1. Replace technical or low-level error text with human-readable, localized business messages.
2. Introduce `PaymentAgent` as formal scoped master data with multi-file attachments stored on NAS and tracked by uploaded-asset lifecycle management.
3. Make `Edit Payment Detail` behave like a stable business editor:
   - no cursor loss,
   - readable linked receipt labels,
   - re-evaluated order/receipt/customer linkage on save.
4. Make `Export Pic` produce a readable JPG that matches the confirmed `MU Group` visual structure and business semantics.
5. Make `SWIFT OCR` normalize business values before validation and confirm-create.
6. Apply special invoice ordering so `deposit pool` and `未匹配池` always appear first.

---

## 3. Non-Goals

1. No global redesign of all OCR providers or OCR prompts.
2. No generalized document engine for every export type; this change is specific to `Payment Detail -> Export Pic`.
3. No change to approval model in this round.
4. No cross-module public/global `AGENT` directory; visibility follows the same ownership hierarchy pattern as customers.

---

## 4. User-Facing Behavior

### 4.1 SWIFT Validation Messaging

When the SWIFT amount differs too much from the selected payment detail, the user should not see a numeric tolerance diagnostic.

Required messages:
- zh: `与 payment details 金额差异过大，录入失败`
- en: `Amount differs too much from the selected payment detail. Record creation failed.`

Low-level messages such as:
- `Invalid input: expected number, received NaN`
- or mixed Chinese text in English locale
must no longer leak to the dialog.

### 4.2 Invoice Priority Ordering

`Invoice Management` display order becomes:

1. `deposit pool`
2. `未匹配池`
3. all other invoices with `outstanding > 0`
4. all other invoices with `outstanding = 0`

Within groups 3 and 4:
- invoices with empty `shipDate` appear first,
- the rest sort by `shipDate` from earliest to latest,
- ties fall back to `invNo`.

### 4.3 Edit Payment Detail

- `Linked Receipt` always shows human-readable `orderNo`, never `receiptNo` or raw database ID.
- Editing `ORDER NO` must not lose cursor focus on every keystroke.
- When a user changes `ORDER NO`, the UI should preview whether it will:
  - relink to an existing receipt,
  - or create a new receipt on save.
- On save/submit, the backend must re-run matching and, if necessary, create the missing receipt inside the same transaction.

### 4.4 Payment Agent

`Payment Detail Management` gains an `AGENT` button at the top right.

Inside the agent management dialog:
- `SALES` and above can create/edit visible agents.
- each agent includes:
  - company name
  - company address
  - contact name
  - contact phone
  - multiple company files (attachments)

In `Upload Payment Detail`:
- agent selection is visible and required for confirm-create,
- OCR can still run without selecting an agent,
- `Confirm` remains disabled until an agent is selected.

### 4.5 Payment Detail Export Pic

The generated image must follow the business layout confirmed by the user:

Header:
- `MU Group` logo on the left
- date on the right

Summary row:
- total amount
- transaction count

Table columns:
- `#`
- `MARK`
- `ORDER NO`
- `TYPE`
- `AMOUNT`

Footer:
- blue bar with `TOTAL TRANSFERRED` and total amount
- final small text line:
  - `<agent company name> · Disbursement`
  - `<record count> records`

`TYPE` rules:
- `Initial`: first payment ever recorded for that `ORDER NO`
- `Final`: after this detail’s SWIFT is received, resulting order balance is `<= 5`
- `Std`: every other case

All existing payment details, regardless of status or creation mode, can export.

### 4.6 SWIFT OCR Normalization

`SWIFT OCR` continues using business fields from Block 4:
- `:50K:` -> sender name / sender address
- `:59:` -> receiver account / receiver name

Receiver account cleanup rules:
- remove leading `/`
- remove spaces
- map `o`/`O` to `0`
- keep digits only
- if the final result is empty, treat it as missing

Amount cleanup rules:
- strip commas and spaces
- coerce to a valid number before schema validation
- never pass `NaN` into confirm-create

---

## 5. Architecture

### 5.1 Error Presentation Layer

Keep the existing `api-error` and `api-error-catalog` as the transport/error-code base, but add a second, scenario-aware presentation layer.

Responsibilities:
- map low-level codes or messages into dialog-specific business wording,
- preserve localization,
- provide last-resort normalization for schema/library text.

Examples:
- generic numeric schema failure -> `Invalid input. Please check numeric and required fields.`
- SWIFT tolerance rejection -> `Amount differs too much from the selected payment detail. Record creation failed.`

This layer should be shared by:
- `Receipt`
- `Payment Detail`
- `SWIFT`
- future OCR dialogs

### 5.2 Payment Agent Master Data

Add formal master-data tables:

#### `PaymentAgent`
- `id`
- `companyName`
- `companyAddress`
- `contactName`
- `contactPhone`
- `createdBy`
- timestamps

#### `PaymentAgentFile`
- `id`
- `agentId`
- `name`
- `path`
- `mimeType`
- `size`
- `uploadedBy`
- timestamps

Visibility:
- follows the same ownership-hierarchy access model as customers.

Attachments:
- stored on NAS
- tracked through `UploadedAsset`
- directory recommendation:
  - `upload/files/agents/<agentId>/...`

### 5.3 Detail Relinking Service

Introduce a focused service/helper that handles the business effects of changing a detail item’s `ORDER NO`.

Responsibilities:
- normalize and resolve the new order number using the global matching kernel,
- find a matching existing receipt when available,
- otherwise create a new receipt at save time inside the transaction,
- recompute canonical mark/customer linkage,
- return readable linked-receipt labels for the UI,
- keep the rest of `Detail` write logic reusable.

Important rule:
- the UI never creates receipts during typing,
- only `Save/Submit` triggers formal creation inside the backend transaction.

### 5.4 Detail Export ViewModel + Template Renderer

Export should no longer derive layout ad hoc from hand-built SVG logic.

Introduce a pipeline:
1. build a `DetailExportViewModel`
2. render a frozen HTML/CSS template using project-owned assets
3. rasterize to JPG

The template remains a product artifact with fixed business layout. The code only injects data.

### 5.5 SWIFT Normalization Layer

Before confirm-create or update:
- run OCR result cleanup through a dedicated helper,
- normalize amount/date/account/name/address strings,
- only then pass the payload into validators and services.

This avoids coupling OCR quirks to API-level schema failures.

---

## 6. Detailed Behavior Rules

### 6.1 Linked Receipt Labels

`Edit Payment Detail` must display linked receipts using only:
- linked receipt `orderNo`, or
- `Unmatched`

Never show:
- raw `receiptId`
- raw receipt number
- internal UUID-like values such as `cmosdqc3d001boz01r0hw70tx`

### 6.2 Order Change Preview and Save

When the user edits an item’s `ORDER NO`:
- the UI maintains local draft state with stable row keys,
- a debounced preview resolves whether the value points to:
  - an existing receipt,
  - or a new receipt that will be created on save.

On save:
1. re-run resolution server-side
2. create or relink receipt as needed
3. recompute canonical mark/customer linkage
4. persist everything atomically

If a new receipt must be created, it uses the same business creation path already used by payment detail processing today, not a separate ad hoc record path.

### 6.3 Export `TYPE` Classification

For each detail row:

#### `Initial`
The exported row is the first payment ever recorded for that `ORDER NO`.

#### `Final`
After this detail’s associated SWIFT has been received, the resulting outstanding balance for that `ORDER NO` is `<= 5`.

#### `Std`
All other cases.

`TYPE` calculation must be done in a dedicated helper/service, not inside the template layer.

### 6.4 Agent Requirement in OCR Flow

`Upload Payment Detail` dialog states:
- OCR recognition may complete without an agent selected.
- The final `Confirm` action remains disabled until:
  - a valid OCR result exists,
  - and an agent is selected.

The chosen agent is then stored on the resulting detail record so the export footer can use it.

### 6.5 Invoice Priority Names

Special top-priority groups are matched by canonical invoice labels:
- `deposit pool`
- `未匹配池`

Matching must be case-insensitive for the English label and exact/normalized for the Chinese special pool label where needed.

If future pool names become configurable, this priority list should be read from configuration; this spec keeps them hardcoded.

---

## 7. Data Model and API Changes

### 7.1 Prisma

Add:
- `PaymentAgent`
- `PaymentAgentFile`
- `agentId` relation on `Detail` (required for new creates after rollout; nullable during migration if needed)

### 7.2 Detail API

Extend `/api/detail`:
- support listing/maintaining agents, or add dedicated `/api/agent` if separation is cleaner
- support relink/create-preview metadata if needed by the editor
- `export-pic` uses the new ViewModel/template renderer

### 7.3 SWIFT API

Normalize OCR payload before schema parsing.

Update/create flows should route errors through the new presentation layer so UI receives business-readable messages.

### 7.4 Uploaded Asset Integration

Agent file uploads must:
- write to NAS,
- register `UploadedAsset`,
- attach to the owning `PaymentAgentFile`,
- and participate in orphan cleanup rules through the same asset lifecycle system.

---

## 8. Migration Strategy

1. Add new `PaymentAgent` and `PaymentAgentFile` tables.
2. Add nullable `agentId` to detail records if a staged rollout is required.
3. Backfill existing details with `agentId = null`; export should handle null agents with a safe placeholder until newly edited/created rows are assigned.
4. Once stable, require agent selection for all new OCR-created detail records.

No automatic migration of arbitrary historical attachments into agents is required.

---

## 9. Testing Strategy

### 9.1 Service/API
- agent CRUD with scoped visibility
- multi-file attachment lifecycle and asset registration
- detail order change that relinks to existing receipt
- detail order change that creates a new receipt on save
- export type classification (`Initial` / `Final` / `Std`)
- SWIFT receiver account normalization
- SWIFT tolerance rejection localized message
- invoice special-group ordering

### 9.2 UI
- `Edit Payment Detail` keeps cursor while typing `ORDER NO`
- linked receipt label shows order numbers only
- upload detail dialog disables confirm until agent selected
- mobile dialogs keep footer actions visible

### 9.3 End-to-End / Isolated API
- create agent -> upload detail OCR -> confirm with agent -> export picture
- upload SWIFT with messy receiver account OCR -> cleaned payload persists
- invoice ordering returns special pools first

---

## 10. Files Likely to Change

### Prisma / Data
- `prisma/schema.prisma`
- new migration under `prisma/migrations/...`

### Services
- `src/lib/api-error-catalog.ts`
- `src/lib/detail-service.ts`
- `src/lib/detail-export-image.ts`
- new `src/lib/detail-export-view-model.ts`
- new `src/lib/payment-agent-service.ts`
- new `src/lib/payment-agent-file-service.ts`
- new `src/lib/detail-relink-service.ts`
- `src/lib/swift-service.ts`
- `src/lib/ocr.ts`
- `src/lib/ocr-input.ts`

### API
- `src/app/api/detail/route.ts`
- `src/app/api/swift/route.ts`
- likely new `src/app/api/agent/route.ts`

### Frontend
- `src/components/workspace/modules/details/detail-manager.tsx`
- `src/components/workspace/modules/details/components/detail-edit-dialog.tsx`
- `src/components/workspace/modules/details/components/detail-upload-dialog.tsx`
- `src/components/workspace/modules/details/components/detail-list.tsx`
- `src/components/workspace/modules/details/hooks/use-detail-actions.ts`
- `src/components/workspace/modules/swifts/components/swift-upload-dialog.tsx`
- `src/components/workspace/modules/swifts/hooks/use-swift-actions.ts`
- `src/components/workspace/modules/invoices/hooks/use-invoice-ordering.ts`

### Tests
- `src/app/api/detail/route.test.ts`
- `src/app/api/swift/route.test.ts`
- `src/components/workspace/modules/details/detail-manager.test.tsx`
- `src/components/workspace/modules/details/hooks/use-detail-actions.test.tsx`
- `src/components/workspace/modules/swifts/hooks/use-swift-actions.test.tsx`
- new tests for agent services and export ViewModel

---

## 11. Success Criteria

1. Users no longer see raw schema/`NaN`/technical error text in `SWIFT` and `Detail` dialogs.
2. `Invoice Management` always shows `deposit pool` and `未匹配池` first.
3. Editing `ORDER NO` in `Payment Detail` no longer loses cursor focus and results in correct relink/create behavior on save.
4. `Export Pic` output is readable, branded correctly, and semantically matches the confirmed business template.
5. `Upload Payment Detail` requires a scoped `AGENT` selection before confirm-create.
6. `SWIFT` receiver account and amount values are normalized before validation, eliminating OCR-driven `NaN` or malformed account persistence.
