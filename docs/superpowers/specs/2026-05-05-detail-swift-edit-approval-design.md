# Detail And Swift Edit Approval Design

Date: 2026-05-05
Status: Drafted for implementation planning

## Summary

Extend the existing receipt edit approval model to `Payment Detail` and `Swift`.

Editing rules:

- `SALES` can open edit UI for visible records, but submitted changes become approval requests instead of applying immediately.
- `ADMIN` can directly edit visible records with immediate effect.
- Managers can approve or reject `SALES` requests only when the target record is visible to them and their hierarchy is higher than the requester.
- Only one `PENDING` edit request may exist per target `Detail` or `Swift` at a time.
- User-facing success feedback must distinguish between immediate edits and approval submissions:
  - `修改已完成 / Modification completed`
  - `成功提交，等待管理员同意 / Submitted successfully. Waiting for admin approval`

## Goals

- Reuse the proven receipt edit approval model instead of inventing a second workflow.
- Keep `Detail` and `Swift` rows as the source of truth for effective business state.
- Preserve current visibility and hierarchy constraints.
- Keep every approval action transactional, auditable, and retry-safe.
- Restrict editable states so approved history cannot be rewritten after the chain is completed.

## Non-Goals

- No support for `USER` role editing.
- No bulk edit workflow.
- No modification of any status field, error field, approval record, or completion result.
- No image replacement or upload flow changes in this iteration.
- No global cross-module approval center.
- No support for editing `RECEIVED` detail/swift records.

## Editable Scope

### Detail

Editable only when status is `Waiting_SWIFT` or `ERROR`.

Allowed fields:

- `date`
- `items[]`
  - `mark`
  - `orderNo`
  - `amount`
  - `receiptId`

Not editable:

- `status`
- `totalAmount` as direct input
- `imageUrl`
- `imageName`
- history/audit rows

`totalAmount` continues to be derived from approved `items[]`.

### Swift

Editable only when status is `ERROR` or `Bank_Transfer`.

Allowed fields:

- `date`
- `amount`
- `senderName`
- `senderAddress`
- `receiverName`
- `receiverAccount`

Not editable:

- `status`
- `hasError`
- `errorMessage`
- `imageUrl`
- `imageName`

## Design Choice

Use two dedicated approval entities:

- `DetailEditRequest`
- `SwiftEditRequest`

Why:

- This is the fastest safe extension of the already-merged receipt approval model.
- `Detail` and `Swift` each already have distinct update rules, payloads, and status restrictions.
- A generic `ResourceEditRequest` table would add abstraction without reducing this iteration's implementation risk.
- Dedicated tables make per-resource pending uniqueness, query filtering, and audit review easier to understand and test.

## Data Model

### New enums

`DetailEditRequestStatus`

- `PENDING`
- `APPROVED`
- `REJECTED`

`SwiftEditRequestStatus`

- `PENDING`
- `APPROVED`
- `REJECTED`

### New table: `DetailEditRequest`

Fields:

- `id`
- `detailId`
- `status`
- `requestedBy`
- `approvedBy` nullable
- `requestedAt`
- `reviewedAt` nullable
- `beforeSnapshot` JSON
- `afterSnapshot` JSON
- `reviewComment` nullable
- `pendingDetailId` nullable unique helper for active request enforcement
- `createdAt`
- `updatedAt`

### New table: `SwiftEditRequest`

Fields:

- `id`
- `swiftId`
- `status`
- `requestedBy`
- `approvedBy` nullable
- `requestedAt`
- `reviewedAt` nullable
- `beforeSnapshot` JSON
- `afterSnapshot` JSON
- `reviewComment` nullable
- `pendingSwiftId` nullable unique helper for active request enforcement
- `createdAt`
- `updatedAt`

### Snapshot schemas

`DetailEditRequest.beforeSnapshot` and `afterSnapshot` store only the editable subset:

```json
{
  "date": "2026-05-05",
  "items": [
    {
      "mark": "MAB-1",
      "orderNo": "MAB-1-10",
      "amount": 100,
      "receiptId": "receipt-id"
    }
  ]
}
```

`SwiftEditRequest.beforeSnapshot` and `afterSnapshot` store only the editable subset:

```json
{
  "date": "2026-05-05",
  "amount": 100,
  "senderName": "Sender",
  "senderAddress": "Conakry",
  "receiverName": "Receiver",
  "receiverAccount": "123456"
}
```

### Constraints

- At most one `PENDING` request per `detailId`.
- At most one `PENDING` request per `swiftId`.
- Historical approved/rejected requests remain queryable.
- Approval must re-check target row state inside the approving transaction before applying any mutation.

## Permission Model

### Who can open edit UI

- `SALES`: yes, for visible records.
- `ADMIN`: yes, for visible records.
- `USER`: no.

### Who can submit edit requests

- `SALES`: yes, request-only.
- `ADMIN`: no request flow; direct update only.

### Who can approve or reject

Reviewer must satisfy all of the following:

- target record is visible to reviewer
- reviewer role is `ADMIN`
- reviewer hierarchy is higher than requester hierarchy
- reviewer is not the requester

### Direct update rules

`ADMIN` direct update remains synchronous and applies immediately if:

- target record is visible
- target record is in an editable status
- payload passes existing validation rules

## Update Application Strategy

Approved edits must not bypass existing business validation.

### Detail approval application

Approval should apply the stored `afterSnapshot` by reusing the existing `updateDetailRecord(...)` path.

Implications:

- `totalAmount` continues to be recomputed by existing service logic.
- `receiptId` linkage still goes through existing visibility and relationship validation.
- any automatic matching or history creation already present in `updateDetailRecord(...)` remains authoritative.

### Swift approval application

Add an explicit `updateSwiftRecord(...)` service and use it for both:

- direct `ADMIN` edits
- approved `SALES` edit requests

`updateSwiftRecord(...)` must reuse the same tolerance validation and state recalculation rules already used by `createSwiftRecord(...)`.

Implications:

- editable records can stay in `ERROR` if the approved update is still invalid
- editable records can remain or move within allowed operational states according to existing validation logic
- no manual override of `hasError` or `status`

## API Design

Keep the API shape aligned with receipt edit approval.

### `/api/detail`

Actions:

- `update`
  - allowed for `ADMIN`
  - direct apply
- `request-edit`
  - allowed for `SALES`
  - create pending request
- `review-edit`
  - allowed for approving managers
  - approve or reject
- `list-edit-requests`
  - return visible request rows

`request-edit` request body:

```json
{
  "action": "request-edit",
  "detailId": "detail-id",
  "data": {
    "date": "2026-05-05",
    "items": [
      {
        "mark": "MAB-1",
        "orderNo": "MAB-1-10",
        "amount": 100,
        "receiptId": "receipt-id"
      }
    ]
  }
}
```

### `/api/swift`

Actions:

- `update`
  - add this action; it does not exist today
  - allowed for `ADMIN`
  - direct apply
- `request-edit`
  - allowed for `SALES`
  - create pending request
- `review-edit`
  - allowed for approving managers
  - approve or reject
- `list-edit-requests`
  - return visible request rows

`request-edit` request body:

```json
{
  "action": "request-edit",
  "swiftId": "swift-id",
  "data": {
    "date": "2026-05-05",
    "amount": 100,
    "senderName": "Sender",
    "senderAddress": "Conakry",
    "receiverName": "Receiver",
    "receiverAccount": "123456"
  }
}
```

### Shared review request body

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

## Service Layer

Add dedicated approval services instead of burying approval logic inside existing resource services.

Recommended files:

- `src/lib/detail-edit-request-service.ts`
- `src/lib/swift-edit-request-service.ts`

Core functions:

- `requestDetailEdit(...)`
- `reviewDetailEdit(...)`
- `listDetailEditRequests(...)`
- `requestSwiftEdit(...)`
- `reviewSwiftEdit(...)`
- `listSwiftEditRequests(...)`

Existing services remain responsible for authoritative business updates:

- `updateDetailRecord(...)`
- new `updateSwiftRecord(...)`

## UI Design

### Detail page

- Add `Edit` action to visible detail rows for `SALES+`
- Add `DetailEditDialog`
- Add `Pending edit requests` section inside `Payment Detail`

Submission behavior:

- `SALES` -> request approval
- `ADMIN` -> direct update

### Swift page

- Add `Edit` action to visible swift rows for `SALES+`
- Add `SwiftEditDialog`
- Add `Pending edit requests` section inside `Swift`

Submission behavior:

- `SALES` -> request approval
- `ADMIN` -> direct update

### Feedback

Direct update success:

- `修改已完成 / Modification completed`

Approval submission success:

- `成功提交，等待管理员同意 / Submitted successfully. Waiting for admin approval`

Duplicate pending submission:

- explicit blocking message
- user cannot create a second request until the current one becomes `APPROVED` or `REJECTED`

## Audit

Add dedicated audit actions for each resource:

- `DETAIL_EDIT_REQUEST_CREATE`
- `DETAIL_EDIT_REQUEST_APPROVE`
- `DETAIL_EDIT_REQUEST_REJECT`
- `SWIFT_EDIT_REQUEST_CREATE`
- `SWIFT_EDIT_REQUEST_APPROVE`
- `SWIFT_EDIT_REQUEST_REJECT`

Audit metadata should include:

- requester id
- reviewer id when present
- target status before review
- editable field snapshot diff or before/after subset

## Error Handling

- Reject direct update or request creation if target resource is not in editable status.
- Reject request creation if target record is not visible.
- Reject approval if reviewer loses visibility or hierarchy eligibility.
- Reject approval if request is no longer `PENDING`.
- Reject duplicate `PENDING` request creation for the same target.
- Preserve current validation errors from `updateDetailRecord(...)` and `updateSwiftRecord(...)` instead of hiding them behind generic approval errors.

## Testing

### Service tests

Add unit tests for both new approval services:

- `SALES` can submit request for visible editable record
- duplicate `PENDING` request rejected
- `ADMIN` direct update path remains immediate
- reviewer hierarchy/visibility enforcement
- self-approval forbidden
- approval applies snapshots through existing update service
- approval rejected when target status becomes non-editable before review

### API tests

Add isolated API coverage for:

- detail request-edit / review-edit / list-edit-requests
- swift request-edit / review-edit / list-edit-requests
- direct admin update for both resources

### Frontend tests

- edit dialogs submit the correct action by role
- success message differs by role
- pending request sections render visible rows
- duplicate pending state blocks additional sales submission

## Rollout Notes

- This feature reuses the receipt approval model conceptually, but does not require a shared generic approval table in this iteration.
- Documentation, tests, version, Docker, and Git metadata must be updated together when implementation lands.
- After this ships, `Receipt / Detail / Swift` will all follow the same edit approval pattern, which becomes the stable template for future editable business resources.
