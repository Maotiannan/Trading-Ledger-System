# Detail And Swift Edit Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the receipt-style edit approval flow to `Payment Detail` and `Swift`, so `SALES` submits pending edit requests while `ADMIN` applies visible edits immediately, without weakening status boundaries, visibility rules, or auditability.

**Architecture:** Add two dedicated approval entities, `DetailEditRequest` and `SwiftEditRequest`, instead of overloading the existing update paths. Reuse `updateDetailRecord(...)` for approved detail mutations, add a new `updateSwiftRecord(...)` for both direct admin edits and approved swift requests, and wire both modules through request/review/list API actions that mirror the already-shipped receipt approval flow.

**Tech Stack:** Next.js App Router, Prisma/MySQL, React/TypeScript, Jest, isolated API tests, existing audit/ownership/transaction helpers.

---

## File Structure

**Create**
- `prisma/migrations/<timestamp>_detail_swift_edit_request/migration.sql` — schema changes for detail/swift edit approvals.
- `src/lib/detail-edit-request-service.ts` — request/review/list logic for detail edit approvals.
- `src/lib/swift-edit-request-service.ts` — request/review/list logic for swift edit approvals.
- `src/lib/detail-edit-request-service.test.ts` — service tests for detail approval flow.
- `src/lib/swift-edit-request-service.test.ts` — service tests for swift approval flow.
- `src/components/workspace/modules/details/components/detail-edit-dialog.tsx` — editable detail dialog shared by `SALES` and `ADMIN`.
- `src/components/workspace/modules/swifts/components/swift-edit-dialog.tsx` — editable swift dialog shared by `SALES` and `ADMIN`.
- `tests/api/isolated/cases/67-detail-edit-approval.case.mjs` — end-to-end detail approval verification.
- `tests/api/isolated/cases/68-swift-edit-approval.case.mjs` — end-to-end swift approval verification.

**Modify**
- `prisma/schema.prisma` — new enums/models/relations.
- `src/lib/audit-catalog.ts` — new detail/swift edit approval audit actions.
- `src/lib/api-catalog.ts` — new detail/swift actions.
- `src/lib/store.ts` — request row and editable patch types for detail/swift.
- `src/lib/detail-service.ts` — tighten direct `update` role guard and expose normalized update behavior for approval application.
- `src/lib/swift-service.ts` — add `updateSwiftRecord(...)` and direct update guard.
- `src/app/api/detail/route.ts` — add `request-edit`, `review-edit`, `list-edit-requests`.
- `src/app/api/swift/route.ts` — add `update`, `request-edit`, `review-edit`, `list-edit-requests`.
- `src/components/workspace/modules/details/hooks/use-detail-actions.ts` — submit direct updates vs approval requests, load/review request rows.
- `src/components/workspace/modules/swifts/hooks/use-swift-actions.ts` — same for swift.
- `src/components/workspace/modules/details/components/detail-list.tsx` — add `Edit` action and request section.
- `src/components/workspace/modules/swifts/components/swift-list.tsx` — add `Edit` action and request section.
- `src/components/workspace/modules/details/detail-manager.tsx` — state wiring for detail edit dialog and request list.
- `src/components/workspace/modules/swifts/swift-manager.tsx` — state wiring for swift edit dialog and request list.
- `src/components/workspace/modules/details/hooks/use-detail-actions.test.tsx` — hook tests for role-based submit/review logic.
- `src/components/workspace/modules/swifts/hooks/use-swift-actions.test.tsx` — hook tests for role-based submit/review logic.
- `src/components/workspace/modules/details/detail-manager.test.tsx` — UI regression coverage.
- `src/components/workspace/modules/swifts/swift-manager.test.tsx` — UI regression coverage.
- `README.md`, `todolist.md`, `ENGINEERING_LOG.md`, `package.json`, `package-lock.json` — release/documentation/version sync.

## Task 1: Add persistence for detail/swift edit requests

**Files:**
- Create: `prisma/migrations/<timestamp>_detail_swift_edit_request/migration.sql`
- Modify: `prisma/schema.prisma`
- Test: `npx prisma validate`

- [ ] **Step 1: Add the failing schema definitions**

```prisma
enum DetailEditRequestStatus {
  PENDING
  APPROVED
  REJECTED
}

enum SwiftEditRequestStatus {
  PENDING
  APPROVED
  REJECTED
}

model DetailEditRequest {
  id              String                  @id @default(cuid())
  detailId        String
  status          DetailEditRequestStatus @default(PENDING)
  requestedBy     String
  approvedBy      String?
  requestedAt     DateTime                @default(now())
  reviewedAt      DateTime?
  beforeSnapshot  Json
  afterSnapshot   Json
  reviewComment   String?
  pendingDetailId String?                 @unique
  createdAt       DateTime                @default(now())
  updatedAt       DateTime                @updatedAt

  detail          Detail                  @relation(fields: [detailId], references: [id], onDelete: Cascade)
  requester       User                    @relation("DetailEditRequester", fields: [requestedBy], references: [id], onDelete: Cascade)
  approver        User?                   @relation("DetailEditApprover", fields: [approvedBy], references: [id], onDelete: SetNull)

  @@index([detailId, status])
  @@index([requestedBy, status])
  @@index([approvedBy])
}

model SwiftEditRequest {
  id             String                 @id @default(cuid())
  swiftId        String
  status         SwiftEditRequestStatus @default(PENDING)
  requestedBy    String
  approvedBy     String?
  requestedAt    DateTime               @default(now())
  reviewedAt     DateTime?
  beforeSnapshot Json
  afterSnapshot  Json
  reviewComment  String?
  pendingSwiftId String?                @unique
  createdAt      DateTime               @default(now())
  updatedAt      DateTime               @updatedAt

  swift          Swift                  @relation(fields: [swiftId], references: [id], onDelete: Cascade)
  requester      User                   @relation("SwiftEditRequester", fields: [requestedBy], references: [id], onDelete: Cascade)
  approver       User?                  @relation("SwiftEditApprover", fields: [approvedBy], references: [id], onDelete: SetNull)

  @@index([swiftId, status])
  @@index([requestedBy, status])
  @@index([approvedBy])
}
```

Add reverse relations:

```prisma
model Detail {
  // ...existing fields...
  editRequests DetailEditRequest[]
}

model Swift {
  // ...existing fields...
  editRequests SwiftEditRequest[]
}

model User {
  // ...existing fields...
  requestedDetailEditRequests DetailEditRequest[] @relation("DetailEditRequester")
  approvedDetailEditRequests  DetailEditRequest[] @relation("DetailEditApprover")
  requestedSwiftEditRequests  SwiftEditRequest[]  @relation("SwiftEditRequester")
  approvedSwiftEditRequests   SwiftEditRequest[]  @relation("SwiftEditApprover")
}
```

- [ ] **Step 2: Run schema validation to verify shape issues before migration generation**

Run: `cd /Users/maotiannan/dev/docker/Trading-Ledger-System && npx prisma validate`
Expected: Prisma reports any relation or enum mistakes immediately; fix them before migration generation.

- [ ] **Step 3: Generate the migration SQL**

```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npx prisma migrate dev --name detail_swift_edit_request --create-only
```

Expected SQL shape:

```sql
CREATE TABLE `DetailEditRequest` (...);
CREATE TABLE `SwiftEditRequest` (...);
CREATE UNIQUE INDEX `DetailEditRequest_pendingDetailId_key` ON `DetailEditRequest`(`pendingDetailId`);
CREATE UNIQUE INDEX `SwiftEditRequest_pendingSwiftId_key` ON `SwiftEditRequest`(`pendingSwiftId`);
```

- [ ] **Step 4: Re-run Prisma validation**

Run: `cd /Users/maotiannan/dev/docker/Trading-Ledger-System && npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add detail and swift edit request persistence"
```

## Task 2: Drive detail/swift approval services from tests first

**Files:**
- Create: `src/lib/detail-edit-request-service.test.ts`, `src/lib/swift-edit-request-service.test.ts`
- Modify: `src/lib/audit-catalog.ts`, `src/lib/store.ts`
- Test: `npm test -- --runInBand src/lib/detail-edit-request-service.test.ts src/lib/swift-edit-request-service.test.ts`

- [ ] **Step 1: Write failing detail approval service tests**

```ts
it('creates a pending detail edit request for SALES on a visible Waiting_SWIFT detail', async () => {
  db.detail.findUnique.mockResolvedValue({
    id: 'detail-1',
    createdBy: 'sales-owner',
    status: 'Waiting_SWIFT',
    date: null,
    items: [{ mark: 'MAB-1', orderNo: 'MAB-1-10', amount: 100, receiptId: 'receipt-1' }],
  });
  canAccessOwnedResourceAsync.mockResolvedValue(true);
  db.detailEditRequest.findFirst.mockResolvedValue(null);
  db.detailEditRequest.create.mockResolvedValue({ id: 'detail-req-1', status: 'PENDING' });

  const result = await requestDetailEdit({
    currentUser: salesUser,
    detailId: 'detail-1',
    data: {
      date: '2026-05-05',
      items: [{ mark: 'MAB-2', orderNo: 'MAB-2-11', amount: 120, receiptId: 'receipt-2' }],
    },
  });

  expect(result.message).toMatch(/等待管理员同意/);
  expect(db.detailEditRequest.create).toHaveBeenCalled();
});

it('rejects detail edit requests when the detail is RECEIVED', async () => {
  db.detail.findUnique.mockResolvedValue({ id: 'detail-2', createdBy: 'sales-owner', status: 'RECEIVED', items: [] });
  canAccessOwnedResourceAsync.mockResolvedValue(true);

  await expect(requestDetailEdit({ currentUser: salesUser, detailId: 'detail-2', data: validDetailPatch })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
    message: expect.stringMatching(/RECEIVED/),
  });
});
```

- [ ] **Step 2: Write failing swift approval service tests**

```ts
it('creates a pending swift edit request for SALES on a visible Bank_Transfer swift', async () => {
  db.swift.findUnique.mockResolvedValue({
    id: 'swift-1',
    createdBy: 'sales-owner',
    status: 'Bank_Transfer',
    hasError: false,
    detailId: 'detail-1',
    date: null,
    amount: 100,
    senderName: 'Old Sender',
    senderAddress: null,
    receiverName: 'Old Receiver',
    receiverAccount: null,
  });
  canAccessOwnedResourceAsync.mockResolvedValue(true);
  db.swiftEditRequest.findFirst.mockResolvedValue(null);
  db.swiftEditRequest.create.mockResolvedValue({ id: 'swift-req-1', status: 'PENDING' });

  const result = await requestSwiftEdit({
    currentUser: salesUser,
    swiftId: 'swift-1',
    data: {
      date: '2026-05-05',
      amount: 110,
      senderName: 'New Sender',
      senderAddress: 'Conakry',
      receiverName: 'New Receiver',
      receiverAccount: '123',
    },
  });

  expect(result.message).toMatch(/等待管理员同意/);
  expect(db.swiftEditRequest.create).toHaveBeenCalled();
});

it('rejects swift edit requests when the swift status is RECEIVED', async () => {
  db.swift.findUnique.mockResolvedValue({ id: 'swift-2', createdBy: 'sales-owner', status: 'RECEIVED', hasError: false });
  canAccessOwnedResourceAsync.mockResolvedValue(true);

  await expect(requestSwiftEdit({ currentUser: salesUser, swiftId: 'swift-2', data: validSwiftPatch })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
    message: expect.stringMatching(/RECEIVED/),
  });
});
```

- [ ] **Step 3: Add audit actions and shared frontend types needed by later tasks**

```ts
// src/lib/audit-catalog.ts
DETAIL_EDIT_REQUEST_CREATE: 'DETAIL_EDIT_REQUEST_CREATE',
DETAIL_EDIT_REQUEST_APPROVE: 'DETAIL_EDIT_REQUEST_APPROVE',
DETAIL_EDIT_REQUEST_REJECT: 'DETAIL_EDIT_REQUEST_REJECT',
SWIFT_EDIT_REQUEST_CREATE: 'SWIFT_EDIT_REQUEST_CREATE',
SWIFT_EDIT_REQUEST_APPROVE: 'SWIFT_EDIT_REQUEST_APPROVE',
SWIFT_EDIT_REQUEST_REJECT: 'SWIFT_EDIT_REQUEST_REJECT',
```

```ts
// src/lib/store.ts
export type DetailEditableItemPatch = {
  mark: string | null;
  orderNo: string | null;
  amount: number;
  receiptId: string | null;
};

export type DetailEditablePatch = {
  date: string | null;
  items: DetailEditableItemPatch[];
};

export type SwiftEditablePatch = {
  date: string | null;
  amount: number;
  senderName: string | null;
  senderAddress: string | null;
  receiverName: string | null;
  receiverAccount: string | null;
};
```

- [ ] **Step 4: Run the focused tests and verify they fail on missing service implementations**

Run: `cd /Users/maotiannan/dev/docker/Trading-Ledger-System && npm test -- --runInBand src/lib/detail-edit-request-service.test.ts src/lib/swift-edit-request-service.test.ts`
Expected: FAIL because request/review/list functions do not exist yet.

- [ ] **Step 5: Commit**

```bash
git add src/lib/detail-edit-request-service.test.ts src/lib/swift-edit-request-service.test.ts src/lib/audit-catalog.ts src/lib/store.ts
git commit -m "test: drive detail and swift edit approval services"
```

## Task 3: Implement detail and swift approval services

**Files:**
- Create: `src/lib/detail-edit-request-service.ts`, `src/lib/swift-edit-request-service.ts`
- Modify: `src/lib/detail-service.ts`, `src/lib/swift-service.ts`
- Test: `src/lib/detail-edit-request-service.test.ts`, `src/lib/swift-edit-request-service.test.ts`

- [ ] **Step 1: Implement allowlisted patch normalization for detail requests**

```ts
const normalizeDetailPatch = (data: DetailPayload): DetailEditablePatch => ({
  date: data.date ?? null,
  items: data.items.map((item) => ({
    mark: item.mark ?? null,
    orderNo: item.orderNo ?? null,
    amount: item.amount,
    receiptId: item.receiptId || item.matchedReceiptId || null,
  })),
});
```

Use this in `requestDetailEdit(...)` to persist `beforeSnapshot` and `afterSnapshot` and to reject duplicate `PENDING` rows by setting `pendingDetailId` while status is pending.

- [ ] **Step 2: Implement detail request/review/list functions**

```ts
export async function reviewDetailEdit(params: {
  currentUser: CurrentUser;
  requestId: string;
  decision: 'approve' | 'reject';
  comment?: string | null;
}) {
  return runInTransaction(async (tx) => {
    const request = await tx.detailEditRequest.findUnique({
      where: { id: params.requestId },
      include: { detail: true, requester: true },
    });
    if (!request || request.status !== DetailEditRequestStatus.PENDING) throw pendingGoneError();
    assertDetailReviewPermission(request, params.currentUser);
    assertEditableDetailStatus(request.detail.status);

    if (params.decision === 'approve') {
      await updateDetailRecord({
        currentUser: params.currentUser,
        detailId: request.detailId,
        payload: request.afterSnapshot as DetailPayload,
      });
    }

    return tx.detailEditRequest.update({
      where: { id: request.id },
      data: {
        status: params.decision === 'approve' ? DetailEditRequestStatus.APPROVED : DetailEditRequestStatus.REJECTED,
        approvedBy: params.currentUser.id,
        reviewedAt: new Date(),
        reviewComment: params.comment ?? null,
        pendingDetailId: null,
      },
    });
  });
}
```

- [ ] **Step 3: Implement `updateSwiftRecord(...)` and wire swift approval application through it**

```ts
export async function updateSwiftRecord(params: {
  currentUser: CurrentUser;
  swiftId: string;
  payload: SwiftPayload;
}) {
  const existing = await db.swift.findUnique({
    where: { id: params.swiftId },
    include: { detail: { include: { items: true } } },
  });
  if (!existing) throw notFoundError();
  if (!(await canAccessOwnedResourceAsync(existing.createdBy, params.currentUser))) throw forbiddenError();
  assertEditableSwiftStatus(existing.status);

  const validation = validateAmountTolerance(Number(existing.detail.totalAmount), params.payload.amount, {
    warningTolerance: await getNumericSystemSetting('SWIFT_WARNING_TOLERANCE', 5, { min: 0 }),
    rejectTolerance: await getNumericSystemSetting('SWIFT_REJECT_TOLERANCE', 50, { min: 0 }),
  });

  return runInTransaction(async (tx) => {
    const updated = await tx.swift.update({
      where: { id: params.swiftId },
      data: {
        date: params.payload.date ? new Date(params.payload.date) : null,
        amount: params.payload.amount,
        senderName: params.payload.senderName,
        senderAddress: params.payload.senderAddress,
        receiverName: params.payload.receiverName,
        receiverAccount: params.payload.receiverAccount,
        status: validation.valid ? SwiftStatus.Bank_Transfer : SwiftStatus.ERROR,
        hasError: validation.hasWarning || !validation.valid,
        errorMessage: validation.valid ? null : validation.message,
      },
      include: { detail: { include: { items: true } } },
    });
    return { data: updated, validation };
  });
}
```

- [ ] **Step 4: Re-run focused service tests**

Run: `cd /Users/maotiannan/dev/docker/Trading-Ledger-System && npm test -- --runInBand src/lib/detail-edit-request-service.test.ts src/lib/swift-edit-request-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/detail-edit-request-service.ts src/lib/swift-edit-request-service.ts src/lib/detail-service.ts src/lib/swift-service.ts
git commit -m "feat: add detail and swift edit approval services"
```

## Task 4: Expose approval actions through detail/swift API routes

**Files:**
- Modify: `src/app/api/detail/route.ts`, `src/app/api/swift/route.ts`, `src/lib/api-catalog.ts`
- Test: `src/app/api/detail/route.test.ts`, `src/app/api/swift/route.test.ts`

- [ ] **Step 1: Add failing route tests for detail actions**

```ts
it('POST /api/detail request-edit returns pending approval success for SALES', async () => {
  requestDetailEdit.mockResolvedValue({ message: '成功提交，等待管理员同意', request: { id: 'req-1' } });
  const response = await POST(makeActionRequest({ action: 'request-edit', detailId: 'detail-1', data: validDetailPatch }), salesUser);
  const body = await response.json();
  expect(body.success).toBe(true);
  expect(body.message).toMatch(/等待管理员同意/);
});
```

- [ ] **Step 2: Add failing route tests for swift actions, including new `update` action**

```ts
it('POST /api/swift update calls updateSwiftRecord for ADMIN payloads', async () => {
  updateSwiftRecord.mockResolvedValue({ data: { id: 'swift-1' }, validation: { valid: true, hasWarning: false, message: null } });
  const response = await POST(makeActionRequest({ action: 'update', swiftId: 'swift-1', data: validSwiftPatch }), adminUser);
  const body = await response.json();
  expect(body.success).toBe(true);
  expect(updateSwiftRecord).toHaveBeenCalled();
});
```

- [ ] **Step 3: Implement route wiring and API catalog entries**

```ts
// /api/detail
if (action === 'request-edit') {
  const result = await requestDetailEdit({ currentUser, detailId, data: parseDetailPayload(requestData) });
  return createApiSuccessResponse({ data: result.request, message: result.message }, request);
}
if (action === 'review-edit') {
  const result = await reviewDetailEdit({ currentUser, requestId, decision, comment });
  return createApiSuccessResponse({ data: result, message: result.message }, request);
}
if (action === 'list-edit-requests') {
  const rows = await listDetailEditRequests(currentUser);
  return NextResponse.json({ success: true, data: rows });
}
```

Same shape for `/api/swift`, plus `action === 'update'` calling `updateSwiftRecord(...)`.

Add API catalog rows:

```ts
{ action: 'request-edit', method: 'POST', description: 'Submit a detail edit request for approval (sales)' }
{ action: 'review-edit', method: 'POST', description: 'Approve or reject a pending detail edit request (admin)' }
{ action: 'list-edit-requests', method: 'POST', description: 'List visible detail edit requests' }
```

- [ ] **Step 4: Run route tests**

Run: `cd /Users/maotiannan/dev/docker/Trading-Ledger-System && npm test -- --runInBand src/app/api/detail/route.test.ts src/app/api/swift/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/detail/route.ts src/app/api/swift/route.ts src/app/api/detail/route.test.ts src/app/api/swift/route.test.ts src/lib/api-catalog.ts
git commit -m "feat: add detail and swift edit approval api"
```

## Task 5: Add detail/swift edit dialogs and action hooks

**Files:**
- Create: `src/components/workspace/modules/details/components/detail-edit-dialog.tsx`, `src/components/workspace/modules/swifts/components/swift-edit-dialog.tsx`
- Modify: `src/components/workspace/modules/details/hooks/use-detail-actions.ts`, `src/components/workspace/modules/swifts/hooks/use-swift-actions.ts`, `src/components/workspace/modules/details/hooks/use-detail-actions.test.tsx`, `src/components/workspace/modules/swifts/hooks/use-swift-actions.test.tsx`
- Test: focused hook tests

- [ ] **Step 1: Add failing hook tests for role-based submit behavior**

```tsx
it('submits detail request-edit for SALES and returns pending approval message', async () => {
  mockedApiCall.mockResolvedValue({ success: true, message: '成功提交，等待管理员同意', data: { id: 'req-1' } });
  const { result } = renderHook(() => useDetailActions(detailPropsForSales));
  await act(async () => {
    await result.current.handleEditSubmit('detail-1', validDetailPatch);
  });
  expect(mockedApiCall).toHaveBeenCalledWith('detail', expect.objectContaining({ action: 'request-edit' }));
  expect(window.alert).toHaveBeenCalledWith(expect.stringMatching(/等待管理员同意/));
});

it('submits swift update for ADMIN and returns direct success message', async () => {
  mockedApiCall.mockResolvedValue({ success: true, message: '修改已完成', data: { id: 'swift-1' } });
  const { result } = renderHook(() => useSwiftActions(swiftPropsForAdmin));
  await act(async () => {
    await result.current.handleEditSubmit('swift-1', validSwiftPatch);
  });
  expect(mockedApiCall).toHaveBeenCalledWith('swift', expect.objectContaining({ action: 'update' }));
  expect(window.alert).toHaveBeenCalledWith(expect.stringMatching(/修改已完成/));
});
```

- [ ] **Step 2: Build the detail/swift edit dialogs with allowlisted fields only**

```tsx
<Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{tx('修改付款明细', 'Edit Payment Detail')}</DialogTitle>
    </DialogHeader>
    <Input type="date" value={form.date} onChange={...} />
    {form.items.map((item, index) => (
      <div key={index} className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <Input value={item.mark ?? ''} onChange={...} />
        <Input value={item.orderNo ?? ''} onChange={...} />
        <Input type="number" value={item.amount} onChange={...} />
        <Input value={item.receiptId ?? ''} onChange={...} />
      </div>
    ))}
  </DialogContent>
</Dialog>
```

`SwiftEditDialog` should expose only the six allowed fields.

- [ ] **Step 3: Implement hook actions for request/review/list**

```ts
const editAction = currentUser.role === 'SALES' ? 'request-edit' : 'update';
await apiCall('detail', {
  action: editAction,
  detailId,
  data: patch,
});

const requestsResult = await apiCall('detail', { action: 'list-edit-requests' });
if (requestsResult.success) setDetailEditRequests(requestsResult.data ?? []);
```

Mirror this for `swift`, and add `handleReviewEditRequest(...)` helpers for approve/reject.

- [ ] **Step 4: Run focused hook tests**

Run: `cd /Users/maotiannan/dev/docker/Trading-Ledger-System && npm test -- --runInBand src/components/workspace/modules/details/hooks/use-detail-actions.test.tsx src/components/workspace/modules/swifts/hooks/use-swift-actions.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/modules/details/components/detail-edit-dialog.tsx src/components/workspace/modules/swifts/components/swift-edit-dialog.tsx src/components/workspace/modules/details/hooks/use-detail-actions.ts src/components/workspace/modules/swifts/hooks/use-swift-actions.ts src/components/workspace/modules/details/hooks/use-detail-actions.test.tsx src/components/workspace/modules/swifts/hooks/use-swift-actions.test.tsx
git commit -m "feat: add detail and swift edit approval actions"
```

## Task 6: Wire managers, lists, and request sections into the UI

**Files:**
- Modify: `src/components/workspace/modules/details/detail-manager.tsx`, `src/components/workspace/modules/swifts/swift-manager.tsx`, `src/components/workspace/modules/details/components/detail-list.tsx`, `src/components/workspace/modules/swifts/components/swift-list.tsx`, `src/components/workspace/modules/details/detail-manager.test.tsx`, `src/components/workspace/modules/swifts/swift-manager.test.tsx`
- Test: UI regression tests

- [ ] **Step 1: Add failing manager tests for edit entry and pending request sections**

```tsx
it('shows detail edit action for SALES and pending request section for visible managers', async () => {
  render(<DetailManager />);
  expect(await screen.findByRole('button', { name: /Edit/i })).toBeInTheDocument();
  expect(await screen.findByText(/Pending edit requests/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Extend list components with edit action and request section**

```tsx
<Button variant="outline" size="sm" onClick={() => onEdit(detail)}>
  {tx('修改', 'Edit')}
</Button>
```

Add request rendering block:

```tsx
{editRequests.length > 0 ? (
  <Card>
    <CardHeader>
      <CardTitle>{tx('待审批修改', 'Pending edit requests')}</CardTitle>
    </CardHeader>
    <CardContent>{/* rows + approve/reject buttons */}</CardContent>
  </Card>
) : null}
```

- [ ] **Step 3: Wire managers with dialog state, request loading, and review actions**

```tsx
const [editingDetail, setEditingDetail] = useState<DetailRow | null>(null);
const [detailEditRequests, setDetailEditRequests] = useState<DetailEditRequestRow[]>([]);

useEffect(() => {
  loadDetails();
  loadDetailEditRequests();
}, [loadDetails, loadDetailEditRequests]);
```

Mirror this structure for `SwiftManager`.

- [ ] **Step 4: Run focused manager tests**

Run: `cd /Users/maotiannan/dev/docker/Trading-Ledger-System && npm test -- --runInBand src/components/workspace/modules/details/detail-manager.test.tsx src/components/workspace/modules/swifts/swift-manager.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/modules/details/detail-manager.tsx src/components/workspace/modules/swifts/swift-manager.tsx src/components/workspace/modules/details/components/detail-list.tsx src/components/workspace/modules/swifts/components/swift-list.tsx src/components/workspace/modules/details/detail-manager.test.tsx src/components/workspace/modules/swifts/swift-manager.test.tsx
git commit -m "feat: add detail and swift edit approval ui"
```

## Task 7: Add isolated API coverage for the full approval flows

**Files:**
- Create: `tests/api/isolated/cases/67-detail-edit-approval.case.mjs`, `tests/api/isolated/cases/68-swift-edit-approval.case.mjs`
- Test: isolated API runner

- [ ] **Step 1: Write failing detail approval flow case**

```js
export default async function run() {
  const { adminCookie, salesCookie } = await seedUsersAndLogin();
  const detail = await createWaitingSwiftDetail(adminCookie);

  const requestRes = await post('/api/detail', salesCookie, {
    action: 'request-edit',
    detailId: detail.id,
    data: {
      date: '2026-05-05',
      items: [{ mark: 'MAB-2', orderNo: 'MAB-2-11', amount: 120, receiptId: detail.items[0].receiptId }],
    },
  });
  assert.equal(requestRes.success, true);
  assert.match(requestRes.message, /等待管理员同意/);

  const listRes = await post('/api/detail', adminCookie, { action: 'list-edit-requests' });
  const req = listRes.data.find((row) => row.detailId === detail.id);
  assert.ok(req);

  const reviewRes = await post('/api/detail', adminCookie, { action: 'review-edit', requestId: req.id, decision: 'approve' });
  assert.equal(reviewRes.success, true);
}
```

- [ ] **Step 2: Write failing swift approval flow case**

```js
export default async function run() {
  const { adminCookie, salesCookie } = await seedUsersAndLogin();
  const swift = await createEditableSwift(adminCookie);

  const requestRes = await post('/api/swift', salesCookie, {
    action: 'request-edit',
    swiftId: swift.id,
    data: {
      date: '2026-05-05',
      amount: 110,
      senderName: 'New Sender',
      senderAddress: 'Conakry',
      receiverName: 'New Receiver',
      receiverAccount: '123',
    },
  });
  assert.equal(requestRes.success, true);

  const listRes = await post('/api/swift', adminCookie, { action: 'list-edit-requests' });
  const req = listRes.data.find((row) => row.swiftId === swift.id);
  assert.ok(req);

  const reviewRes = await post('/api/swift', adminCookie, { action: 'review-edit', requestId: req.id, decision: 'approve' });
  assert.equal(reviewRes.success, true);
}
```

- [ ] **Step 3: Run isolated cases and fix fixture mismatches**

Run: `cd /Users/maotiannan/dev/docker/Trading-Ledger-System && npm run test:api:isolated -- --case 67-detail-edit-approval --case 68-swift-edit-approval`
Expected: initially FAIL until route/service/UI plumbing is complete; iterate until PASS.

- [ ] **Step 4: Re-run the isolated cases after implementation**

Run: `cd /Users/maotiannan/dev/docker/Trading-Ledger-System && npm run test:api:isolated -- --case 67-detail-edit-approval --case 68-swift-edit-approval`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/api/isolated/cases/67-detail-edit-approval.case.mjs tests/api/isolated/cases/68-swift-edit-approval.case.mjs
git commit -m "test: cover detail and swift edit approval flows"
```

## Task 8: Sync docs, version, and full verification

**Files:**
- Modify: `README.md`, `todolist.md`, `ENGINEERING_LOG.md`, `package.json`, `package-lock.json`
- Test: full project verification and Docker rebuild

- [ ] **Step 1: Update version and docs**

```json
// package.json
{
  "version": "1.0.112"
}
```

Add concise release notes to:

```md
- Detail and Swift now support the same edit approval flow as Receipts.
- SALES submits edit requests; ADMIN can edit directly or approve/reject visible lower-level requests.
```

- [ ] **Step 2: Run Prisma generate before app verification**

Run: `cd /Users/maotiannan/dev/docker/Trading-Ledger-System && npx prisma generate`
Expected: Prisma client regenerates with `DetailEditRequestStatus` and `SwiftEditRequestStatus` available.

- [ ] **Step 3: Run full verification**

Run: `cd /Users/maotiannan/dev/docker/Trading-Ledger-System && npm run build`
Expected: PASS

Run: `cd /Users/maotiannan/dev/docker/Trading-Ledger-System && npm run test:ci`
Expected: PASS

- [ ] **Step 4: Rebuild local Docker and verify the running app version**

Run: `cd /Users/maotiannan/dev/docker/Trading-Ledger-System && docker compose up -d --build`
Expected: containers rebuild successfully

Run: `curl -k -I https://localhost`
Expected: `HTTP/2 200`

Run: `docker exec trading-ledger-system-app-1 node -p "require('./package.json').version"`
Expected: `1.0.112`

- [ ] **Step 5: Commit**

```bash
git add README.md todolist.md ENGINEERING_LOG.md package.json package-lock.json
git commit -m "chore: release v1.0.112"
```
