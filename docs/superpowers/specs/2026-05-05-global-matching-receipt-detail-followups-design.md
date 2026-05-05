# Global Matching And Receipt/Detail Follow-Ups Design

## Status
Approved for design. Implementation will proceed in three batches under one shared plan so context does not fragment.

## Context
Recent user feedback exposed a deeper problem than single-page bugs: matching behavior is inconsistent across invoice import, OCR-assisted receipt flows, signed receipt generation, and customer maintenance. At the same time, several UI and document-generation follow-ups are now blocked on those matching semantics being correct and globally shared.

A separate P0 hotfix was completed first for `Upload Payment Detail -> Confirm Create`, because that bug blocked current production usage. That hotfix is not part of this spec's scope except as a completed prerequisite.

## Goals
1. Make all `ORDER_NAME`-based matching use one shared global rule.
2. Allow a single customer master profile to own multiple independent `ORDER_NAME` values.
3. Bring `Invoice -> Bulk Import Invoices` up to the same matching quality as the rest of the system.
4. Make receipt OCR backfill prefer database truth whenever an OCR `ORDER NO` matches an existing order.
5. Add the remaining receipt/detail UI and export improvements without introducing new rule divergence.

## Explicit Non-Goals
1. No global approval-center refactor.
2. No rework of unrelated OCR prompt templates beyond what is required for backfill order and data mapping.
3. No attempt to make `orderNo` globally unique; the current uniqueness boundary remains `@@unique([invoiceId, orderNo])` unless later requirements change.
4. No one-cell multi-`ORDER_NAME` entry during customer create/import.

## Core Business Semantics

### Customer With Multiple ORDER_NAME Values
A customer has one master profile and can own multiple distinct `ORDER_NAME` prefixes.

Example:
- Customer master info:
  - Name: `Mamadou Aliou Barry`
  - Phone: `+224 620 07 11 76`
- Bound `ORDER_NAME`s:
  - `MAB-1`
  - `MARY`

Implications:
- `MAB-1-10` and `MARY-01` are different orders and must not interfere with each other.
- Both should resolve to the same customer master info.
- User entry/import still records only one `ORDER_NAME` at a time.
- Additional `ORDER_NAME`s are added only in `Customer Management -> Edit`.

### Global Ignore-Spaces Matching Rule
Every place that uses `ORDER_NAME` matching must normalize spacing in the same way.

Examples that must all match the same bound `ORDER_NAME = SUPER DT 2`:
- `SUPERDT2-01`
- `S U P E R D T 2 -01`
- `SUPER DT 2-01`

When a match succeeds, the system must backfill the canonical customer master data, not the user's raw input.

Example:
- Customer master:
  - `MARK = SDT 2`
  - bound `ORDER_NAME = SUPER DT 2`
- Input order number: `SUPERDT2-01`
- Result:
  - resolved customer is that master row
  - backfilled `MARK` is `SDT 2`, not `SUPERDT2`

## Shared Architecture

### 1. Customer Master + ORDER_NAME Child Table
Current `Customer.orderName` is insufficient because it only stores one value. Replace the single-value semantic with:
- `Customer` = master profile
- `CustomerOrderName` = one row per bound order prefix

Proposed data shape:
- `Customer`
  - keeps master fields (`mark`, `name`, `phone`, `city`, `companyName`, etc.)
- `CustomerOrderName`
  - `id`
  - `customerId`
  - `value`
  - normalized value columns for lookup
  - timestamps

Rules:
- Customer create/import still provides exactly one `ORDER_NAME`.
- Customer edit UI can add/remove additional `ORDER_NAME` rows.
- A single customer may own many `ORDER_NAME`s.
- An `ORDER_NAME` belongs to exactly one customer within the visible owner scope.

### 2. Global Matching Kernel
Introduce a shared matching module that all entry points call.

Responsibilities:
- normalize whitespace-insensitive tokens
- extract order prefix from `ORDER NO`
- compare candidate `ORDER_NAME`s using shared normalization
- prefer canonical customer master data on match
- preserve existing `MARK` exact-match priority where applicable

Recommended stages:
1. Exact `MARK` match using canonical mark rules
2. Derive `ORDER_NAME` candidate from `ORDER NO`
3. Match against `CustomerOrderName` using shared normalization
4. Return canonical customer master fields and matched alias metadata

This kernel becomes the only place where `ORDER_NAME` spacing behavior is defined.

## Batch Plan

### Batch A: Matching Engine, Customer Model, and Invoice/Receipt Core Flows
Includes requirements `1 / 2 / 6 / 8 / 9`.

#### A1. Customer Model Upgrade
- Add `CustomerOrderName` table.
- Migrate existing `Customer.orderName` values into child rows.
- Keep legacy `Customer.orderName` temporarily only if needed for staged migration; final read paths should use the child table.

#### A2. Customer Management UI/Import Rules
- Create/import still accept exactly one `ORDER_NAME`.
- Edit page allows adding/removing multiple `ORDER_NAME`s for the same customer.
- Import never uses a semicolon-packed multi-value cell.
- This prevents ambiguity while still enabling one customer to serve multiple order prefixes.

#### A3. Invoice Bulk Import Matching Upgrade
`Bulk Import Invoices` must call the same matching kernel used by the rest of the system.

Target outcome:
- imports such as `SUPER DT2-09` and `MAB-1-10B` resolve the same way as manual create/edit/rematch flows
- ignore-spaces rule applies here too
- canonical customer data is written back

#### A4. Receipt OCR Backfill Priority Change
For `Upload Receipt -> OCR`:
1. OCR extracts `ORDER NO`
2. If database finds an existing matching order, the dialog backfills all relevant fields from database truth
3. Only if no order match exists does the dialog fall back to OCR field values

This changes precedence, not just one field.
The following should come from database when order match exists:
- `INV NO`
- `MARK`
- `payer`
- `phone`
- related customer context

#### A5. Invoice Order Edit Gains `INV NO`
Order edit in `Invoice Management` gains editable `INV NO`.

Semantics:
- changing `INV NO` reassigns that order to another invoice group
- after save, the order must appear under the target invoice group
- this must be transactional
- no partial state where the order belongs to neither group

Recommended rule:
- reject unknown target `INV NO` rather than silently creating a new invoice during edit
- silent creation can be considered later as a separate configurable policy

### Batch B: Receipt Page and Mobile Usability
Includes requirements `3 / 7`.

#### B1. Receipt Balance Column
Add `Balance` to the receipt list, immediately to the right of `Amount`.

Meaning:
- resulting order balance after this receipt amount is applied
- if no corresponding order exists, show `-`

This should use the same order balance source used elsewhere in the system, not a client-side guess.

#### B2. Mobile `Upload Receipt` Dialog Fix
Current issue: after OCR finishes, the bottom action button can render outside the viewport.

Required behavior:
- dialog remains usable on narrow mobile screens
- content may scroll
- action/footer stays reachable
- no button should render permanently below the visible area

Recommended implementation:
- scrollable content region
- sticky footer action area
- height capped to viewport

### Batch C: Detail Export and Signed Receipt Payment Mode
Includes requirements `4 / 5`.

#### C1. `Payment Detail -> Create Directly` Export Pic
For direct-created detail records, add `Export Pic` at the far right.

Output format:
- generated from system data, not OCR source image
- layout follows the attached handwritten format semantically:
  - top line summary with total amount and date
  - numbered lines of mark / amount / payment-for text
  - total amount transferred footer

This should be a rendered system image so future style refinements remain programmable.

#### C2. Signed Receipt `Mode de paiement`
Add a new field to `Generate Signed Receipt`:
- dialog input: dropdown
- options only:
  - `Cash`
  - `Transfer`
- default:
  - `Cash`

Rendering:
- on the same line as `RESTE A PAYER`
- aligned to the far right

## Matching Examples Locked By This Spec

### Example 1: Ignore Spaces
Customer master:
- `MARK = SDT 2`
- bound order name: `SUPER DT 2`

Inputs that must match:
- `SUPERDT2-01`
- `S U P E R D T 2 -01`
- `SUPER DT 2-01`

Backfill result:
- canonical `MARK = SDT 2`
- related payer/phone/company info from the customer master profile

### Example 2: One Customer, Two ORDER_NAME Values
Customer master:
- `Name = Mamadou Aliou Barry`
- `Phone = +224 620 07 11 76`
- bound order names:
  - `MAB-1`
  - `MARY`

Input orders:
- `MAB-1-10`
- `MARY-01`

Result:
- both resolve to the same customer master profile
- they remain distinct orders and distinct invoice/receipt/detail records
- no collision just because they share a customer

### Example 3: Receipt OCR Prefers Database Truth
OCR returns:
- `ORDER NO = MAB-1-10`
- `INV NO = OCR-WRONG`

Database already knows:
- order `MAB-1-10` belongs to invoice `L25MH071089C`
- customer mark is `MAB-1`
- payer/phone are known

Result:
- UI backfills `INV NO = L25MH071089C`
- `MARK`, `payer`, `phone` also come from database
- OCR values are fallback only when no order match exists

## Data Migration Strategy
1. Add `CustomerOrderName` table and indexes.
2. Backfill one child row from each existing `Customer.orderName`.
3. Switch reads to child-table matching.
4. Keep compatibility bridge only as long as needed for safe rollout.
5. Add regression tests before removing old assumptions.

## Error Handling
- If `ORDER_NAME` alias conflicts inside a visible owner scope, return explicit conflict instead of guessing.
- If invoice order edit targets a missing `INV NO`, return a clear business error.
- If receipt OCR finds an order but supporting invoice/customer data is inconsistent, surface a structured error instead of mixing OCR and database sources silently.

## Testing Strategy

### Unit / Service
- shared normalization and prefix extraction
- customer alias matching
- invoice regroup on `INV NO` change
- receipt OCR precedence rules

### Isolated API
- bulk invoice import with spacing variants
- receipt OCR returning wrong `INV NO` but correct `ORDER NO`
- customer with multiple bound `ORDER_NAME` values
- invoice order reassignment between invoice groups

### UI / E2E
- mobile receipt upload dialog remains operable after OCR on narrow screens
- detail direct record `Export Pic` renders expected structure
- signed receipt dialog exposes `Mode de paiement`

## Recommended Execution Order
1. Batch A
2. Batch B
3. Batch C

Reason:
- Batch A defines the canonical business resolution rules that Batch B/C depend on.
- Batch B and C should not be implemented on top of legacy matching behavior.

## Open Questions Resolved
- One customer can own multiple `ORDER_NAME`s, but create/import still records one `ORDER_NAME` per row.
- Multiple `ORDER_NAME`s are managed only through customer edit.
- Ignore-spaces matching applies globally anywhere `ORDER_NAME` is used.
- `ORDER NO` is not assumed globally unique.
- `Invoice` order edit must support `INV NO` reassignment as transactional regrouping.
