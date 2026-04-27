# Receipt Generator Integration Design

Date: 2026-04-27
Project: Trading-Ledger-System
Status: Draft for user review

## 1. Goal

Integrate the external `receipt_layout_editor.html` concept into the existing Receipt Management workflow as a first-class project feature.

The final workflow must:
- start from Receipt Management
- collect `ORDER NO` and `USD Amount` inside the project UI
- open a dedicated signing/preview experience
- support desktop and mobile differently for usability
- create a real `Receipt` record before signing
- keep unfinished signing receipts completely outside the business flow
- generate the final receipt PNG after both signatures
- store the PNG on the NAS-mounted upload directory
- download the PNG to the client browser
- return to Receipt Management and refresh the list
- ensure the generated receipt becomes a normal `Create Receipt Directly`-style receipt record with attached image

## 2. Approved Product Decisions

These decisions are already confirmed:
- Use the project-native two-step integration approach rather than embedding the HTML as-is in an iframe.
- Keep both signatures:
  - receiver signature
  - payer signature
- Feature available to every role except `USER`.
- Receipt number must become a real backend-generated atomic sequence.
- Sequence starts at `0001000` and increments upward.
- Receipt record is created before signing, immediately after the user finishes the initial information form.
- If signing is abandoned, the unfinished receipt must not enter the business workflow.
- Desktop uses a separate signing window.
- Mobile uses same-tab full-screen signing flow.
- Mobile signing must support orientation handling; either explicit rotation controls or clearly enforced signing direction.

## 3. Recommended Architecture

### 3.1 Frontend flow

The feature is split into two frontend stages.

#### Stage A: Receipt Management launch form
Inside Receipt Management, add a new entry button:
- Chinese: `生成签名收据`
- English: `Generate Signed Receipt`

Clicking it opens an in-project dialog used only for initial collection fields:
- `ORDER NO`
- `USD Amount`

After ORDER input, the project resolves order context from database and auto-fills:
- `INV NO`
- customer name
- customer mark
- phone
- balance before

If order resolution returns multiple exact invoice matches for the same ORDER:
- show the latest invoice
- highlight it in red
- show explicit warning text

When the user confirms Stage A:
- backend allocates the real `receiptNo`
- backend creates a receipt record in a temporary signing state
- frontend then opens the signing experience

#### Stage B: signing / preview experience
Desktop:
- open a new popup window
- render the receipt preview and two-step signature flow there
- after final success, notify the opener and close the popup

Mobile:
- navigate in the same tab to a dedicated full-screen signing route
- default UI optimized for portrait browsing with explicit full-screen signing area
- signing canvas must support `rotate left` / `rotate right`
- the UI must clearly indicate the intended signature orientation
- after final success, route back to Receipt Management and refresh

### 3.2 Backend flow

The backend is split into a dedicated generator service boundary. Do not overload the existing direct-create API shape with opaque generator behavior.

Recommended new endpoints:

1. `GET /api/receipt-generator/order-context`
- input: `orderNo`, optional amount
- output:
  - exact matched invoice context
  - unique customer context
  - phone
  - balance before
  - duplicate invoice warning state

2. `POST /api/receipt-generator/session`
- creates an unfinished receipt before signing
- allocates atomic `receiptNo`
- stores generator payload snapshot
- returns:
  - session id
  - created receipt id
  - generated receipt number
  - signing route URL

3. `POST /api/receipt-generator/finalize`
- input:
  - session id
  - receiver signature image
  - payer signature image
  - layout snapshot / generator payload
- behavior:
  - compose final PNG
  - save PNG under NAS upload path
  - attach image to created receipt
  - move receipt from temporary signing state into normal receipt workflow start state
  - return created/updated receipt object and image URL

4. optional `POST /api/receipt-generator/cancel`
- explicit user cancel path
- marks unfinished session/receipt as cancelled

## 4. Data Model Changes

### 4.1 Receipt status

Add a new temporary receipt status:
- `SIGNING_PENDING`

Meaning:
- receipt shell exists
- not fully signed
- no final receipt image yet
- must remain outside business processing

### 4.2 Workflow isolation rule

Receipts in `SIGNING_PENDING` must be excluded from:
- receipt business status progression
- detail matching flow
- swift matching flow
- received/archive actions
- deletion approval path unless explicitly allowed by separate rules
- normal receipt dashboard/business summaries unless product explicitly wants them shown

Recommended behavior in Receipt Management list:
- show them in the list for the creator and managers
- visibly mark them as unfinished signing records
- do not expose business flow actions

### 4.3 Generator metadata

Recommended new persistent fields, either directly on `Receipt` or via a dedicated side table:
- generator source = `SIGNED_RECEIPT_GENERATOR`
- signing session id
- receiver signature path
- payer signature path
- layout snapshot JSON
- amount in words snapshot
- balance before / after snapshot

Preferred design:
- create a dedicated `ReceiptGeneratorSession` table
- keep `Receipt` as the business-facing entity
- use the session table for signing-only data and lifecycle

This keeps temporary signing concerns out of the main receipt business model.

## 5. Atomic Receipt Number Allocation

### 5.1 Requirement

`Receipt.receiptNo` becomes a true backend-generated atomic sequence.

Start value:
- `0001000`

### 5.2 Allocation moment

Allocation happens during `POST /api/receipt-generator/session`.

Reason:
- user explicitly requested the receipt should exist before signing
- therefore the number must also exist before signing

### 5.3 Implementation recommendation

Do not infer next number from latest receipt string in application code without locking.

Use one of these durable patterns:
- a dedicated sequence table with one row and transactional increment
- or a dedicated `SystemCounter` table keyed by `RECEIPT_NO`

Recommended format:
- store integer counter in DB
- render to string with left padding to 7 digits

Example:
- counter `1000` => `0001000`
- counter `1001` => `0001001`

## 6. Receipt Content Mapping

The generated receipt payload should map to the existing project direct-create semantics while preserving generator-specific computed fields.

Computed values:
- `receipt_no`: backend allocated atomic receipt number
- `date`: server-side current date by default, then rendered in generator format
- `usd_amount`: input amount
- `amount_in_words`: generated from amount
- `client_name`: `customer_name + ' "' + mark + '"'`
- `client_tel`: from matched customer profile
- `motif`: `Payment for {inv_no} {order_no}`
- `balance_before`: from order context
- `balance_after`: `balance_before - usd_amount`
- `reste_a_payer`: formatted display string derived from before/amount/after
- `received_by`: fixed default label, but should be configuration-capable later if needed

Business receipt fields written into current system record:
- `receiptNo`
- `date`
- `usd`
- `invNo`
- `orderNo`
- `payer`
- `customerId`
- `customerMark`
- `customerName`
- `tel`
- `imageUrl`
- `imageName`

## 7. Mobile UX Rules

Because this flow is expected to be used mostly on phones, mobile UX is not optional.

### 7.1 Route behavior
- mobile stays in same tab
- dedicated route opens full-screen signing interface
- after finalization, redirect back to Receipt Management

### 7.2 Signing behavior
- full-screen canvas area
- explicit step indicator: receiver signature -> payer signature
- orientation controls:
  - rotate left 90°
  - rotate right 90°
- always show visible text explaining which direction is the correct reading orientation

### 7.3 Failure handling
If user leaves midway:
- receipt remains `SIGNING_PENDING`
- no business flow progression occurs
- user can reopen and continue signing later

## 8. NAS Storage Layout

Generated final PNG should go to the mounted NAS upload tree, not to a transient directory.

Recommended path:
- `upload/images/receipts/generated/YYYY/MM/`

Optional sub-files:
- final receipt PNG
- receiver signature PNG
- payer signature PNG

Recommended final storage split:
- final combined receipt image stored in the normal receipt image fields
- signature asset files either stored separately in session metadata or embedded-only if persistence is not required later

## 9. Business Flow Rules

### 9.1 Before finalization
For `SIGNING_PENDING` receipts:
- do not match into detail/swift workflows
- do not affect normal receipt processing
- do not count as normally received money

### 9.2 After finalization
Once both signatures are complete and final PNG is stored:
- receipt exits temporary signing state
- receipt becomes the same kind of business record as a normal direct-created receipt
- initial business status should align with current direct-create behavior

Recommended transition:
- `SIGNING_PENDING` -> current receipt starting status used by direct-create flow

### 9.3 Cancel / abandonment
Recommended explicit behavior:
- incomplete signing records can be resumed or cancelled
- cancelled records should be marked separately or safely deletable without approval because they never entered business flow

## 10. Internationalization

This feature must follow the project’s bilingual pattern.

All of the following must be localized:
- launch button text
- launch form labels
- duplicate invoice warning text
- signing step titles
- orientation hints
- success and failure messages
- unfinished signing status labels
- resume / cancel / finalize prompts

Do not rely on the external HTML’s hardcoded wording.

## 11. Testing Strategy

### 11.1 API tests
Primary verification should remain API-first.

Required API coverage:
- order-context exact ORDER lookup
- multi-invoice same ORDER returns latest + conflict warning
- session creation allocates atomic receipt number
- `SIGNING_PENDING` receipts remain out of business workflow
- finalization creates PNG, writes NAS path, updates receipt image fields
- mobile/desktop path differences do not change backend outcome
- cancellation/resume behavior

### 11.2 Frontend tests
- launch dialog field behavior
- mobile orientation control state logic
- signing step transitions
- callback back to Receipt Management refresh

### 11.3 Playwright
At least one stable desktop end-to-end flow:
- open generator from Receipt Management
- fill form
- open signing window/page
- complete both signatures
- finalize
- return to Receipt Management
- verify latest receipt row appears with image

## 12. Risks and Controls

### Risk 1: orphan unfinished receipts
Control:
- explicit `SIGNING_PENDING`
- excluded from business flow
- resumable/cancellable lifecycle

### Risk 2: phone browser popup restrictions
Control:
- same-tab mobile route, popup only on desktop

### Risk 3: duplicate or racing receipt numbers
Control:
- DB-backed atomic counter, not application-side string guessing

### Risk 4: external HTML diverges from project UI conventions
Control:
- reuse concepts and rendering logic, but integrate through project-native pages and APIs

## 13. Implementation Recommendation

Implement in this order:
1. Add backend atomic receipt counter
2. Add `SIGNING_PENDING` workflow state and isolation guards
3. Add receipt generator service + APIs
4. Build launch dialog in Receipt Management
5. Build signing/preview page for desktop + mobile
6. Add PNG generation + NAS persistence
7. Add resume/cancel logic
8. Add API and Playwright regression coverage

## 14. Acceptance Criteria

The feature is complete when:
- non-USER roles can launch it from Receipt Management
- initial form is inside the project UI
- desktop opens a separate signing window
- mobile uses full-screen same-tab signing with rotation support
- receipt record is created before signing with a real atomic `receiptNo`
- unfinished receipts stay outside business flow
- final PNG is saved to NAS and downloaded locally
- finalized receipt appears at the top of Receipt Management with attached image
- API tests and E2E regression pass

