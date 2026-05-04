# Receipt Edit Approval Design

Date: 2026-05-04
Status: Drafted for implementation planning

## Summary

Add receipt editing for every account with `SALES` or higher permissions, scoped to receipts already visible to that user in the `Receipts` page.

Editing rules:

- `SALES` can submit receipt edit requests, but changes do not apply immediately.
- Any visible management account with a higher hierarchy than the requesting `SALES` can approve or reject the request.
- `ADMIN` and higher can edit receipts directly with immediate effect.
- Only one `PENDING` edit request may exist per receipt at a time.
- User-facing success feedback must distinguish between immediate edits and approval submissions:
  - `修改已完成 / Modification completed`
  - `成功提交，等待管理员同意 / Submitted successfully. Waiting for admin approval`

## Goals

- Add receipt edit capability without weakening current auditability or ownership boundaries.
- Reuse the existing approval philosophy already used by deletion requests.
- Keep the persisted `Receipt` table as the source of truth for effective state.
- Ensure every change is auditable, transactional, and retry-safe.
- Make approval visibility predictable for managers already allowed to see the target receipt.

## Non-Goals

- No support for `USER` role editing.
- No editing of receipt status, detail/swift links, order association side effects, or completion state.
- No bulk receipt edit workflow.
- No global approval dashboard outside the `Receipts` module in this iteration.
- No concurrent multi-request editing for the same receipt.

## Editable Fields

Only these fields are editable:

- `receiptNo`
- `date` (`PAYMENT DATE`)
- `invNo`
- `customerMark`
- `payer`
- `tel`

Everything else remains read-only in this feature.

## Design Choice

Use a dedicated approval entity instead of overloading the existing direct receipt update flow.

Why:

- Direct edits and approval requests have different lifecycles.
- Persisting edit requests independently keeps receipt rows clean and auditable.
- This mirrors the proven deletion request architecture and lowers maintenance risk.

## Data Model

### New enum

`ReceiptEditRequestStatus`

- `PENDING`
- `APPROVED`
- `REJECTED`

### New table

`ReceiptEditRequest`

Fields:

- `id`
- `receiptId`
- `status`
- `requestedBy`
- `approvedBy` nullable
- `requestedAt`
- `reviewedAt` nullable
- `beforeSnapshot` JSON
- `afterSnapshot` JSON
- `reviewComment` nullable
- `createdAt`
- `updatedAt`

### Snapshot schema

Both `beforeSnapshot` and `afterSnapshot` only persist the allowed editable subset:

```json
{
  "receiptNo": "0001001",
  "date": "2026-05-04",
  "invNo": "L25MH070359C",
  "customerMark": "KIGNATEX",
  "payer": "KIGNA TEXTILE",
  "tel": "+224 ..."
}
```

This keeps the payload compact and prevents unauthorized fields from piggybacking through approval.

### Constraints

- At most one `PENDING` request per `receiptId`.
- Requests remain historically visible after approval/rejection.
- Approval applies against the latest stored receipt row, but only if request state is still `PENDING` inside the approving transaction.

## Permission Model

### Who can open the edit UI

- `SALES`, `ADMIN`, `SUPER_ADMIN`: yes, for receipts already visible to them.
- `USER`: no.

### Who can submit requests

- `SALES`: yes, request-only.
- `ADMIN`, `SUPER_ADMIN`: no request flow; direct update only.

### Who can approve/reject

A manager can review a request only if all conditions hold:

- The target receipt is visible to that manager.
- The reviewer is a management role (`ADMIN` or above in the current project role model).
- The reviewer hierarchy is higher than the requester hierarchy.
- The reviewer is not the same user as the requester.

This matches the approved business rule:

> only management accounts that are higher than the requesting `SALES` and can already see the receipt may approve.

## API Design

Extend the existing `/api/receipt` endpoint with dedicated actions.

### Existing direct update

- `action: 'update'`
- Allowed only for `ADMIN` and higher.
- Continues to update the receipt immediately.

### New request action

- `action: 'request-edit'`
- Allowed for `SALES` only.
- Body:

```json
{
  "action": "request-edit",
  "receiptId": "receipt-id",
  "data": {
    "receiptNo": "0001001",
    "date": "2026-05-04",
    "invNo": "L25MH070359C",
    "customerMark": "KIGNATEX",
    "payer": "KIGNA TEXTILE",
    "tel": "+224 ..."
  }
}
```

Behavior:

- Validate receipt existence and visibility.
- Reject if requester is not `SALES`.
- Reject if any existing `PENDING` request already exists for that receipt.
- Persist `beforeSnapshot` from the current receipt row.
- Persist `afterSnapshot` from the validated input.
- Return success message for pending approval.

### New review action

- `action: 'review-edit'`
- Allowed for approving managers only.
- Body:

```json
{
  "action": "review-edit",
  "requestId": "request-id",
  "decision": "approve"
}
```

or

```json
{
  "action": "review-edit",
  "requestId": "request-id",
  "decision": "reject",
  "comment": "optional reason"
}
```

Behavior:

- Lock request in transaction.
- Ensure status is still `PENDING`.
- Re-check receipt visibility and reviewer hierarchy rules.
- `approve`:
  - apply `afterSnapshot` to the receipt row
  - update request status to `APPROVED`
  - store reviewer metadata
- `reject`:
  - update request status to `REJECTED`
  - store reviewer metadata/comment

### New list action

- `action: 'list-edit-requests'`
- Used by the `Receipts` page approval section.
- `SALES` sees requests they submitted for visible receipts.
- Managers see visible requests they are allowed to review, plus already-reviewed visible history.

## Service Layer

Add a dedicated service rather than burying approval logic in `receipt-service.ts`.

Recommended files:

- `src/lib/receipt-edit-request-service.ts`
- extend `src/lib/receipt-service.ts` only for the direct admin update guard changes if needed

Core functions:

- `requestReceiptEdit(...)`
- `reviewReceiptEdit(...)`
- `listReceiptEditRequests(...)`
- `applyApprovedReceiptEdit(...)`

This keeps receipt lifecycle logic and approval workflow logic decoupled.

## UI Design

### Receipt list actions

Add `Edit` action to visible receipts for roles `SALES+`.

Behavior:

- Opens a single edit dialog for the allowed fields.
- Dialog content is shared for both `SALES` and `ADMIN+`.
- Submit behavior depends on role:
  - `SALES` -> submit approval request
  - `ADMIN+` -> direct update

### Success feedback

- `ADMIN+`: `修改已完成 / Modification completed`
- `SALES`: `成功提交，等待管理员同意 / Submitted successfully. Waiting for admin approval`

### Pending approval section

Inside `Receipts`, add a lightweight request list/section for edit requests.

Display at minimum:

- receipt number
- requester
- requested time
- changed fields summary
- status
- approve / reject actions for eligible managers

This stays module-local in this iteration.

## Validation Rules

- Reject empty `receiptId` or malformed dates.
- Normalize empty strings to `null` for optional editable fields where current receipt schema expects nullable values.
- Reject any payload containing fields outside the editable allowlist.
- Reject duplicate `PENDING` request per receipt.
- Reject direct admin edits to receipts outside visible scope.
- Preserve current restrictions that already block updates in forbidden lifecycle states unless business rules explicitly allow them.

## Audit and History

### Audit events

Add catalog entries for:

- `RECEIPT_EDIT_REQUEST_CREATE`
- `RECEIPT_EDIT_REQUEST_APPROVE`
- `RECEIPT_EDIT_REQUEST_REJECT`
- direct admin edits continue to use `RECEIPT_UPDATE`

### Receipt history

When an approved request mutates the receipt, store a `receiptHistory` snapshot before applying changes, same as direct update behavior.

This ensures approval-based edits and direct edits keep the same forensic trail.

## Transaction Boundaries

### Request creation

Single transaction:

- verify no competing `PENDING`
- create request row
- write audit event if audit client pattern allows in-transaction write, otherwise immediately after successful commit following existing project conventions

### Approval

Single transaction:

- load and lock request
- verify request still `PENDING`
- verify receipt still exists
- apply receipt update
- create receipt history snapshot
- update request to `APPROVED`
- write audit event

### Rejection

Single transaction:

- load and lock request
- verify request still `PENDING`
- update request to `REJECTED`
- write audit event

## Error Handling

Structured API errors for:

- `RECEIPT_EDIT_REQUEST_EXISTS`
- `RECEIPT_EDIT_REQUEST_NOT_FOUND`
- `RECEIPT_EDIT_REQUEST_ALREADY_PROCESSED`
- `RECEIPT_EDIT_REVIEW_FORBIDDEN`
- `RECEIPT_EDIT_REQUEST_FORBIDDEN`
- `RECEIPT_EDIT_INVALID_FIELD`

Frontend should surface these as explicit user-facing messages instead of generic failure banners.

## Testing Plan

### Service tests

Add unit tests covering:

- `SALES` can create an edit request for a visible receipt
- duplicate `PENDING` request is rejected
- `ADMIN` direct update still works
- `USER` cannot edit
- non-visible receipt request is rejected
- reviewer with insufficient hierarchy is rejected
- approver cannot review own request
- approval applies only allowlisted fields
- rejection leaves receipt untouched
- already-processed request cannot be re-reviewed

### API isolated tests

Add end-to-end isolated case covering:

1. `SALES` lists visible receipt
2. `SALES` submits edit request
3. second request is blocked while pending
4. eligible manager lists and approves request
5. receipt row reflects approved values
6. second cycle with rejection leaves receipt unchanged
7. direct admin edit returns immediate success path

### Frontend tests

Add hook/UI tests for:

- edit dialog visibility by role
- `SALES` submit success message
- `ADMIN` submit success message
- pending request section rendering
- approve/reject button visibility only for eligible managers

## Migration and Rollout

- Add Prisma migration for enum + `ReceiptEditRequest` table.
- No backfill is required.
- Feature is additive and should be safe for current receipts.
- Existing receipt rows remain untouched until a new request is submitted or a manager directly edits.

## Documentation Updates Required During Implementation

- `README.md`
- `todolist.md`
- `ENGINEERING_LOG.md`
- API catalog entries for new receipt actions
- user-visible behavior note in receipt management section if applicable

## Open Decisions Resolved

The following business decisions are fixed by this spec:

- only these fields are editable: `receiptNo`, `date`, `invNo`, `customerMark`, `payer`, `tel`
- `SALES` requests require approval
- `ADMIN` and higher edits apply immediately
- only visible, higher-hierarchy managers may approve
- one pending request per receipt at a time
- user feedback must distinguish immediate completion vs waiting for approval
