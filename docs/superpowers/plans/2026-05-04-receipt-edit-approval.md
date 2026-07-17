# Receipt Edit Approval Implementation Plan

> **Plan status:** `ARCHIVED_COMPLETED` as of 2026-07-17. The implementation is on `main`; unchecked boxes below are retained as the original execution checklist and are not active backlog. See [the status index](./README.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add editable receipt fields for `SALES+`, with `SALES` changes entering an approval flow and `ADMIN+` changes applying immediately, while preserving auditability, visibility rules, and transactional safety.

**Architecture:** Introduce a dedicated `ReceiptEditRequest` approval entity and service that parallels the existing deletion request pattern. Keep `Receipt` as the source of truth for effective values, route `SALES` through pending requests, and reuse the existing receipt edit dialog for both direct updates and approval submissions.

**Tech Stack:** Next.js App Router, Prisma/MySQL, React/TypeScript, Jest, isolated API tests, existing audit/ownership/transaction helpers.

---

## File Structure

**Create**
- `prisma/migrations/<timestamp>_receipt_edit_request/migration.sql` — schema changes for receipt edit requests.
- `src/lib/receipt-edit-request-service.ts` — request/review/list business logic.
- `src/lib/receipt-edit-request-service.test.ts` — service-level tests.
- `src/components/workspace/modules/receipts/components/receipt-edit-dialog.tsx` — shared edit dialog for `SALES` and `ADMIN+`.
- `tests/api/isolated/cases/66-receipt-edit-approval.case.mjs` — end-to-end approval flow verification.

**Modify**
- `prisma/schema.prisma` — new enum/model relations.
- `src/lib/audit-catalog.ts` — new audit actions.
- `src/lib/api-catalog.ts` — new receipt actions.
- `src/lib/store.ts` — request types exposed to frontend.
- `src/lib/receipt-service.ts` — restrict direct `update` to `ADMIN+` and reuse allowlisted field updates.
- `src/app/api/receipt/route.ts` — wire `request-edit`, `review-edit`, `list-edit-requests`.
- `src/app/api/receipt/route.test.ts` — route coverage for new actions.
- `src/components/workspace/modules/receipts/hooks/use-receipt-actions.ts` — submit direct edits vs approval requests, load request list, approve/reject.
- `src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx` — hook tests for new paths.
- `src/components/workspace/modules/receipts/components/receipt-list.tsx` — add `Edit` action and request section.
- `src/components/workspace/modules/receipts/receipt-manager.tsx` — state wiring for dialog and requests.
- `src/components/workspace/modules/receipts/receipt-manager.test.tsx` — UI smoke/regression assertions.
- `README.md`, `todolist.md`, `ENGINEERING_LOG.md`, `package.json`, `package-lock.json` — release/documentation/version sync.

## Task 1: Add persistence for receipt edit requests

**Files:**
- Create: `prisma/migrations/<timestamp>_receipt_edit_request/migration.sql`
- Modify: `prisma/schema.prisma`
- Test: `npx prisma validate`

- [ ] **Step 1: Add the failing schema definitions**

```prisma
enum ReceiptEditRequestStatus {
  PENDING
  APPROVED
  REJECTED
}

model ReceiptEditRequest {
  id             String                   @id @default(cuid())
  receiptId      String
  status         ReceiptEditRequestStatus @default(PENDING)
  requestedBy    String
  approvedBy     String?
  requestedAt    DateTime                 @default(now())
  reviewedAt     DateTime?
  beforeSnapshot Json
  afterSnapshot  Json
  reviewComment  String?
  createdAt      DateTime                 @default(now())
  updatedAt      DateTime                 @updatedAt

  receipt        Receipt                  @relation(fields: [receiptId], references: [id], onDelete: Cascade)
  requester      User                     @relation("ReceiptEditRequester", fields: [requestedBy], references: [id], onDelete: Cascade)
  approver       User?                    @relation("ReceiptEditApprover", fields: [approvedBy], references: [id], onDelete: SetNull)

  @@index([receiptId, status])
  @@index([requestedBy, status])
  @@index([approvedBy])
}
```

Add reverse relations:

```prisma
model Receipt {
  // ...existing fields...
  editRequests ReceiptEditRequest[]
}

model User {
  // ...existing fields...
  requestedReceiptEditRequests ReceiptEditRequest[] @relation("ReceiptEditRequester")
  approvedReceiptEditRequests  ReceiptEditRequest[] @relation("ReceiptEditApprover")
}
```

- [ ] **Step 2: Run schema validation to verify it fails until migration is generated**

Run: `cd /Users/maotiannan/dev/docker/Trading-Ledger-System && npx prisma validate`

Expected: if relation names or enum references are wrong, Prisma reports the exact schema error.

- [ ] **Step 3: Generate the migration SQL**

```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npx prisma migrate dev --name receipt_edit_request --create-only
```

Expected SQL shape:

```sql
CREATE TABLE `ReceiptEditRequest` (
  `id` VARCHAR(191) NOT NULL,
  `receiptId` VARCHAR(191) NOT NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `requestedBy` VARCHAR(191) NOT NULL,
  `approvedBy` VARCHAR(191) NULL,
  `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `reviewedAt` DATETIME(3) NULL,
  `beforeSnapshot` JSON NOT NULL,
  `afterSnapshot` JSON NOT NULL,
  `reviewComment` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `ReceiptEditRequest_receiptId_status_idx`(`receiptId`, `status`),
  INDEX `ReceiptEditRequest_requestedBy_status_idx`(`requestedBy`, `status`),
  INDEX `ReceiptEditRequest_approvedBy_idx`(`approvedBy`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

- [ ] **Step 4: Re-run Prisma validation**

Run: `cd /Users/maotiannan/dev/docker/Trading-Ledger-System && npx prisma validate`

Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add receipt edit request persistence"
```

## Task 2: Drive the approval service from tests first

**Files:**
- Create: `src/lib/receipt-edit-request-service.test.ts`
- Modify: `src/lib/audit-catalog.ts`, `src/lib/store.ts`
- Test: `src/lib/receipt-edit-request-service.test.ts`

- [ ] **Step 1: Write failing service tests for request creation, duplicate blocking, direct approval, and rejection**

```ts
it('creates a pending receipt edit request for SALES on a visible receipt', async () => {
  db.receipt.findUnique.mockResolvedValue({ id: 'r1', createdBy: 'sales-owner', receiptNo: '0001001', date: null, invNo: 'INV-1', customerMark: 'MAB-1', payer: 'ACME', tel: '123', status: 'SR_Received' });
  canAccessOwnedResourceAsync.mockResolvedValue(true);
  db.receiptEditRequest.findFirst.mockResolvedValue(null);
  db.receiptEditRequest.create.mockResolvedValue({ id: 'req-1', status: 'PENDING' });

  const result = await requestReceiptEdit({
    currentUser: { id: 'sales-1', role: 'SALES', parentId: 'admin-1' } as CurrentUser,
    receiptId: 'r1',
    data: { receiptNo: '0001002', date: '2026-05-04', invNo: 'INV-2', customerMark: 'MAB-2', payer: 'BETA', tel: '456' },
  });

  expect(result.message).toMatch(/等待管理员同意/);
  expect(db.receiptEditRequest.create).toHaveBeenCalled();
});

it('rejects a second pending request for the same receipt', async () => {
  db.receipt.findUnique.mockResolvedValue({ id: 'r1', createdBy: 'sales-owner', status: 'SR_Received' });
  canAccessOwnedResourceAsync.mockResolvedValue(true);
  db.receiptEditRequest.findFirst.mockResolvedValue({ id: 'req-existing', status: 'PENDING' });

  await expect(requestReceiptEdit({ currentUser: salesUser, receiptId: 'r1', data: validEditPayload })).rejects.toMatchObject({ code: 'RECEIPT_EDIT_REQUEST_EXISTS' });
});

it('approves a pending request and updates the receipt in one transaction', async () => {
  db.receiptEditRequest.findUnique.mockResolvedValue({
    id: 'req-1', status: 'PENDING', requestedBy: 'sales-1', receiptId: 'r1',
    afterSnapshot: validEditPayload,
    receipt: { id: 'r1', createdBy: 'sales-owner', receiptNo: '0001001', date: null, invNo: 'INV-1', customerMark: 'MAB-1', payer: 'ACME', tel: '123', status: 'SR_Received' },
    requester: { id: 'sales-1', role: 'SALES', parentId: 'admin-1' },
  });
  canAccessOwnedResourceAsync.mockResolvedValue(true);

  await reviewReceiptEdit({ currentUser: adminUser, requestId: 'req-1', decision: 'approve' });

  expect(tx.receipt.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ receiptNo: '0001002', invNo: 'INV-2' }) }));
  expect(tx.receiptEditRequest.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED' }) }));
});
```

- [ ] **Step 2: Run the focused test file and verify it fails**

Run: `cd /Users/maotiannan/dev/docker/Trading-Ledger-System && npm test -- --runInBand src/lib/receipt-edit-request-service.test.ts`

Expected: FAIL because `requestReceiptEdit` / `reviewReceiptEdit` / `listReceiptEditRequests` do not exist yet.

- [ ] **Step 3: Add audit catalog and frontend types needed by later tasks**

```ts
// src/lib/audit-catalog.ts
RECEIPT_EDIT_REQUEST_CREATE: 'RECEIPT_EDIT_REQUEST_CREATE',
RECEIPT_EDIT_REQUEST_APPROVE: 'RECEIPT_EDIT_REQUEST_APPROVE',
RECEIPT_EDIT_REQUEST_REJECT: 'RECEIPT_EDIT_REQUEST_REJECT',
```

```ts
// src/lib/store.ts
export type ReceiptEditablePatch = {
  receiptNo: string | null;
  date: string | null;
  invNo: string | null;
  customerMark: string | null;
  payer: string | null;
  tel: string | null;
};

export type ReceiptEditRequestRow = {
  id: string;
  receiptId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedBy: string;
  requestedByName: string;
  approvedBy: string | null;
  approvedByName: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  beforeSnapshot: ReceiptEditablePatch;
  afterSnapshot: ReceiptEditablePatch;
  reviewComment: string | null;
};
```

- [ ] **Step 4: Re-run the focused tests**

Run: `cd /Users/maotiannan/dev/docker/Trading-Ledger-System && npm test -- --runInBand src/lib/receipt-edit-request-service.test.ts`

Expected: still FAIL, but now only on missing service implementation rather than missing constants/types.

- [ ] **Step 5: Commit**

```bash
git add src/lib/receipt-edit-request-service.test.ts src/lib/audit-catalog.ts src/lib/store.ts
git commit -m "test: drive receipt edit approval service"
```

## Task 3: Implement the receipt edit approval service

**Files:**
- Create: `src/lib/receipt-edit-request-service.ts`
- Modify: `src/lib/receipt-service.ts`
- Test: `src/lib/receipt-edit-request-service.test.ts`

- [ ] **Step 1: Implement allowlisted payload normalization and request creation**

```ts
const EDITABLE_RECEIPT_FIELDS = ['receiptNo', 'date', 'invNo', 'customerMark', 'payer', 'tel'] as const;

type ReceiptEditablePatch = {
  receiptNo: string | null;
  date: string | null;
  invNo: string | null;
  customerMark: string | null;
  payer: string | null;
  tel: string | null;
};

function normalizeEditableReceiptPatch(input: Record<string, unknown>): ReceiptEditablePatch {
  const unsupported = Object.keys(input).filter((key) => !EDITABLE_RECEIPT_FIELDS.includes(key as typeof EDITABLE_RECEIPT_FIELDS[number]));
  if (unsupported.length > 0) {
    throw createApiError({ code: 'RECEIPT_EDIT_INVALID_FIELD', status: 400, message: '存在不允许修改的字段', detail: { unsupported } });
  }

  return {
    receiptNo: typeof input.receiptNo === 'string' && input.receiptNo.trim() ? input.receiptNo.trim() : null,
    date: typeof input.date === 'string' && input.date.trim() ? input.date.trim() : null,
    invNo: typeof input.invNo === 'string' && input.invNo.trim() ? input.invNo.trim() : null,
    customerMark: typeof input.customerMark === 'string' && input.customerMark.trim() ? input.customerMark.trim() : null,
    payer: typeof input.payer === 'string' && input.payer.trim() ? input.payer.trim() : null,
    tel: typeof input.tel === 'string' && input.tel.trim() ? input.tel.trim() : null,
  };
}

export async function requestReceiptEdit(...) {
  // verify SALES role, visible receipt, no pending request
  // capture beforeSnapshot / afterSnapshot
  // create request row
}
```

- [ ] **Step 2: Implement review and list logic with transactional approval**

```ts
export async function reviewReceiptEdit({ currentUser, requestId, decision, comment }: ReviewParams) {
  return runInTransaction(async (tx) => {
    const request = await tx.receiptEditRequest.findUnique({
      where: { id: requestId },
      include: {
        receipt: true,
        requester: true,
      },
    });

    if (!request) {
      throw createApiError({ code: 'RECEIPT_EDIT_REQUEST_NOT_FOUND', status: 404, message: '修改申请不存在' });
    }
    if (request.status !== 'PENDING') {
      throw createApiError({ code: 'RECEIPT_EDIT_REQUEST_ALREADY_PROCESSED', status: 400, message: '该修改申请已处理' });
    }

    await assertReceiptEditReviewerCanApprove(currentUser, request);

    if (decision === 'reject') {
      return tx.receiptEditRequest.update({
        where: { id: requestId },
        data: { status: 'REJECTED', approvedBy: currentUser.id, reviewedAt: new Date(), reviewComment: comment ?? null },
      });
    }

    await tx.receiptHistory.create({
      data: {
        receiptId: request.receipt.id,
        receiptNo: request.receipt.receiptNo,
        date: request.receipt.date,
        tel: request.receipt.tel,
        usd: request.receipt.usd,
        invNo: request.receipt.invNo,
        orderNo: request.receipt.orderNo,
        payer: request.receipt.payer,
        imageUrl: request.receipt.imageUrl,
        imageName: request.receipt.imageName,
        status: request.receipt.status,
        note: '审批修改前保存',
        createdBy: currentUser.id,
      },
    });

    await tx.receipt.update({
      where: { id: request.receiptId },
      data: {
        receiptNo: request.afterSnapshot.receiptNo,
        date: request.afterSnapshot.date ? new Date(request.afterSnapshot.date) : null,
        invNo: request.afterSnapshot.invNo,
        customerMark: request.afterSnapshot.customerMark,
        payer: request.afterSnapshot.payer,
        tel: request.afterSnapshot.tel,
      },
    });

    return tx.receiptEditRequest.update({
      where: { id: requestId },
      data: { status: 'APPROVED', approvedBy: currentUser.id, reviewedAt: new Date(), reviewComment: comment ?? null },
    });
  });
}
```

- [ ] **Step 3: Restrict direct receipt updates to `ADMIN+` in the existing service**

```ts
if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SUPER_ADMIN) {
  throw forbidden('只有管理员可以直接修改收据', { role: currentUser.role });
}
```

Keep the existing status guards and receiptHistory logic intact.

- [ ] **Step 4: Run the focused service tests until they pass**

Run: `cd /Users/maotiannan/dev/docker/Trading-Ledger-System && npm test -- --runInBand src/lib/receipt-edit-request-service.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/receipt-edit-request-service.ts src/lib/receipt-service.ts src/lib/receipt-edit-request-service.test.ts
git commit -m "feat: implement receipt edit approval service"
```

## Task 4: Expose the new actions through `/api/receipt`

**Files:**
- Modify: `src/app/api/receipt/route.ts`
- Modify: `src/app/api/receipt/route.test.ts`
- Modify: `src/lib/api-catalog.ts`
- Test: `src/app/api/receipt/route.test.ts`

- [ ] **Step 1: Add failing route tests for the new actions**

```ts
it('routes request-edit to the receipt edit request service', async () => {
  mockRequestReceiptEdit.mockResolvedValue({ message: '成功提交，等待管理员同意', data: { id: 'req-1' } });

  const response = await POST(makeAuthedRequest({ action: 'request-edit', receiptId: 'r1', data: validEditPayload }), salesUser);
  const body = await response.json();

  expect(mockRequestReceiptEdit).toHaveBeenCalledWith(expect.objectContaining({ receiptId: 'r1' }));
  expect(body.message).toMatch(/等待管理员同意/);
});

it('routes review-edit to the approval service', async () => {
  mockReviewReceiptEdit.mockResolvedValue({ message: '修改已完成' });
  const response = await POST(makeAuthedRequest({ action: 'review-edit', requestId: 'req-1', decision: 'approve' }), adminUser);
  expect(response.status).toBe(200);
});
```

- [ ] **Step 2: Run route tests to verify they fail**

Run: `cd /Users/maotiannan/dev/docker/Trading-Ledger-System && npm test -- --runInBand src/app/api/receipt/route.test.ts`

Expected: FAIL because the new action branches are not wired.

- [ ] **Step 3: Wire the new action branches and update API catalog**

```ts
if (action === 'request-edit') {
  const result = await requestReceiptEdit({ currentUser, receiptId, data });
  return createApiSuccessResponse({ data: result.data, message: result.message }, request);
}

if (action === 'review-edit') {
  const result = await reviewReceiptEdit({ currentUser, requestId, decision, comment });
  return createApiSuccessResponse({ data: result.data, message: result.message }, request);
}

if (action === 'list-edit-requests') {
  const rows = await listReceiptEditRequests(currentUser);
  return createApiSuccessResponse({ data: rows }, request);
}
```

Add catalog entries:

```ts
{ action: 'request-edit', method: 'POST', description: 'Submit a receipt edit request for approval', bodyExample: { action: 'request-edit', receiptId: 'receipt-id', data: {} } },
{ action: 'review-edit', method: 'POST', description: 'Approve or reject a pending receipt edit request', bodyExample: { action: 'review-edit', requestId: 'request-id', decision: 'approve' } },
{ action: 'list-edit-requests', method: 'GET', description: 'List visible receipt edit requests', queryExample: '?action=list-edit-requests' },
```

- [ ] **Step 4: Re-run route tests**

Run: `cd /Users/maotiannan/dev/docker/Trading-Ledger-System && npm test -- --runInBand src/app/api/receipt/route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/receipt/route.ts src/app/api/receipt/route.test.ts src/lib/api-catalog.ts
git commit -m "feat: expose receipt edit approval actions"
```

## Task 5: Add end-to-end API coverage for the approval flow

**Files:**
- Create: `tests/api/isolated/cases/66-receipt-edit-approval.case.mjs`
- Test: `npm run test:api:isolated`

- [ ] **Step 1: Write the failing isolated API case**

```js
export const name = 'receipt-edit-approval-flow';

export async function run(t) {
  const sales = await t.loginAs('sales');
  const admin = await t.loginAs('admin');

  const receiptId = await t.seedReceipt({ createdBy: sales.user.id, receiptNo: '0001001', invNo: 'INV-1', customerMark: 'MAB-1', payer: 'ACME', tel: '111' });

  const requestCreated = await t.request('POST', '/api/receipt', {
    user: sales,
    body: {
      action: 'request-edit',
      receiptId,
      data: { receiptNo: '0001002', date: '2026-05-04', invNo: 'INV-2', customerMark: 'MAB-2', payer: 'BETA', tel: '222' },
    },
  });
  t.assertOk(requestCreated.data?.success, 'sales can submit edit request');

  const duplicate = await t.request('POST', '/api/receipt', {
    user: sales,
    body: { action: 'request-edit', receiptId, data: { receiptNo: '0001003' } },
  });
  t.assertMatch(duplicate.data?.error || duplicate.text, /已存在/, 'duplicate pending request is blocked');

  const requestRows = await t.request('GET', '/api/receipt?action=list-edit-requests', { user: admin });
  const requestId = requestRows.data?.data?.find((row) => row.receiptId === receiptId)?.id;
  t.assertOk(Boolean(requestId), 'admin can see pending request');

  const approved = await t.request('POST', '/api/receipt', {
    user: admin,
    body: { action: 'review-edit', requestId, decision: 'approve' },
  });
  t.assertOk(approved.data?.success, 'admin can approve request');

  const updatedReceipt = await t.findReceipt(receiptId);
  t.assertEqual(updatedReceipt?.receiptNo, '0001002', 'receipt reflects approved receipt number');
}
```

- [ ] **Step 2: Run isolated API tests to confirm the new case fails**

Run: `cd /Users/maotiannan/dev/docker/Trading-Ledger-System && npm run test:api:isolated`

Expected: FAIL in the new `receipt-edit-approval-flow` case until all actions are wired and persistence works end-to-end.

- [ ] **Step 3: Adjust case helpers or seeded data only if the failure reveals missing visibility/hierarchy fixtures**

```js
// Keep fixtures minimal. If needed, add a helper for finding visible manager user ids
// rather than hardcoding IDs inside the case.
```

- [ ] **Step 4: Re-run isolated API tests after the backend is complete**

Run: `cd /Users/maotiannan/dev/docker/Trading-Ledger-System && npm run test:api:isolated`

Expected: PASS with the new case included.

- [ ] **Step 5: Commit**

```bash
git add tests/api/isolated/cases/66-receipt-edit-approval.case.mjs
git commit -m "test: cover receipt edit approval API flow"
```

## Task 6: Add the receipt edit UI, request list, and role-specific submit behavior

**Files:**
- Create: `src/components/workspace/modules/receipts/components/receipt-edit-dialog.tsx`
- Modify: `src/components/workspace/modules/receipts/components/receipt-list.tsx`
- Modify: `src/components/workspace/modules/receipts/hooks/use-receipt-actions.ts`
- Modify: `src/components/workspace/modules/receipts/receipt-manager.tsx`
- Modify: `src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx`
- Modify: `src/components/workspace/modules/receipts/receipt-manager.test.tsx`
- Test: receipt hook/UI tests

- [ ] **Step 1: Write failing hook/UI tests for edit visibility and role-specific success messages**

```ts
it('submits a receipt edit request for SALES and shows the waiting-for-approval message', async () => {
  mockApiCall.mockResolvedValueOnce({ success: true, message: '成功提交，等待管理员同意', data: { id: 'req-1' } });
  const { result } = renderUseReceiptActionsForRole('SALES');

  await act(async () => {
    await result.current.submitReceiptEdit({ receiptId: 'r1', data: validEditPayload });
  });

  expect(window.alert).toHaveBeenCalledWith(expect.stringMatching(/等待管理员同意/));
});

it('submits a direct receipt update for ADMIN and shows completion message', async () => {
  mockApiCall.mockResolvedValueOnce({ success: true, message: '修改已完成', data: { id: 'r1' } });
  const { result } = renderUseReceiptActionsForRole('ADMIN');

  await act(async () => {
    await result.current.submitReceiptEdit({ receiptId: 'r1', data: validEditPayload });
  });

  expect(window.alert).toHaveBeenCalledWith(expect.stringMatching(/修改已完成/));
});

it('renders edit action for SALES+ but not USER', () => {
  render(<ReceiptList ... isSalesOrHigher />);
  expect(screen.getByTitle('Edit')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:
`cd /Users/maotiannan/dev/docker/Trading-Ledger-System && npm test -- --runInBand src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx src/components/workspace/modules/receipts/receipt-manager.test.tsx`

Expected: FAIL because `submitReceiptEdit`, dialog wiring, and request section do not exist yet.

- [ ] **Step 3: Implement the shared edit dialog and request-list UI**

```tsx
// receipt-edit-dialog.tsx
export function ReceiptEditDialog({
  open,
  onOpenChange,
  tx,
  draft,
  onDraftChange,
  onSubmit,
  submitting,
}: ReceiptEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tx('修改收据', 'Edit Receipt')}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <Input value={draft.receiptNo ?? ''} onChange={(e) => onDraftChange('receiptNo', e.target.value)} />
          <Input type="date" value={draft.date ?? ''} onChange={(e) => onDraftChange('date', e.target.value)} />
          <Input value={draft.invNo ?? ''} onChange={(e) => onDraftChange('invNo', e.target.value)} />
          <Input value={draft.customerMark ?? ''} onChange={(e) => onDraftChange('customerMark', e.target.value)} />
          <Input value={draft.payer ?? ''} onChange={(e) => onDraftChange('payer', e.target.value)} />
          <Input value={draft.tel ?? ''} onChange={(e) => onDraftChange('tel', e.target.value)} />
        </div>
        <DialogFooter>
          <Button onClick={onSubmit} disabled={submitting}>{tx('提交', 'Submit')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Add `Edit` button and pending requests section in `receipt-list.tsx` or `receipt-manager.tsx`, following the existing module-local pattern used by other receipt controls.

- [ ] **Step 4: Implement hook actions for direct update vs request/approval actions**

```ts
const submitReceiptEdit = async ({ receiptId, data }: { receiptId: string; data: ReceiptEditablePatch }) => {
  setSubmitting(true);
  setError(null);
  try {
    const isAdminLike = currentUserRole === 'ADMIN' || currentUserRole === 'SUPER_ADMIN';
    const body = isAdminLike
      ? { action: 'update', receiptId, data }
      : { action: 'request-edit', receiptId, data };

    const result = await apiCall('receipt', { method: 'POST', body: JSON.stringify(body) });
    alert(result.message || (isAdminLike ? tx('修改已完成', 'Modification completed') : tx('成功提交，等待管理员同意', 'Submitted successfully. Waiting for admin approval')));
    await loadReceipts();
    await loadReceiptEditRequests();
  } catch (error) {
    setError(getApiErrorMessage(error, tx('提交收据修改失败', 'Failed to submit receipt edit')));
  } finally {
    setSubmitting(false);
  }
};
```

Also add `reviewReceiptEdit(decision)` and `loadReceiptEditRequests()` helpers.

- [ ] **Step 5: Re-run focused receipt hook/UI tests**

Run:
`cd /Users/maotiannan/dev/docker/Trading-Ledger-System && npm test -- --runInBand src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx src/components/workspace/modules/receipts/receipt-manager.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/workspace/modules/receipts/components/receipt-edit-dialog.tsx \
  src/components/workspace/modules/receipts/components/receipt-list.tsx \
  src/components/workspace/modules/receipts/hooks/use-receipt-actions.ts \
  src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx \
  src/components/workspace/modules/receipts/receipt-manager.tsx \
  src/components/workspace/modules/receipts/receipt-manager.test.tsx
git commit -m "feat: add receipt edit approval UI"
```

## Task 7: Run full verification, update docs/version, and integrate

**Files:**
- Modify: `README.md`, `todolist.md`, `ENGINEERING_LOG.md`, `package.json`, `package-lock.json`
- Test: full project verification

- [ ] **Step 1: Update docs and bump the version**

```json
// package.json
"version": "1.0.111"
```

Add concise entries documenting:
- receipt edit approval request flow for `SALES`
- direct receipt edit for `ADMIN+`
- one pending request per receipt
- approval visibility bound to visible higher-level managers

- [ ] **Step 2: Run database/client refresh commands**

Run:

```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npx prisma generate
```

Expected: Prisma client regenerates cleanly with the new model.

- [ ] **Step 3: Run targeted and full verification**

Run:

```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npm test -- --runInBand src/lib/receipt-edit-request-service.test.ts src/app/api/receipt/route.test.ts src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx src/components/workspace/modules/receipts/receipt-manager.test.tsx
npm run test:api:isolated
npm run build
npm run test:ci
```

Expected:
- targeted suites PASS
- isolated API includes `receipt-edit-approval-flow` PASS
- build PASS
- `test:ci` PASS end-to-end

- [ ] **Step 4: Commit the finished feature**

```bash
git add README.md todolist.md ENGINEERING_LOG.md package.json package-lock.json prisma src tests
git commit -m "feat: add receipt edit approval workflow"
```

- [ ] **Step 5: Merge/publish using the normal repo workflow**

```bash
git status --short --branch
git push origin <feature-branch>
# then merge according to the active repo policy after review
```

## Self-Review

- Spec coverage check:
  - editable fields only: covered in Tasks 2, 3, and 6.
  - `SALES` request flow: covered in Tasks 2, 3, 4, 5, 6.
  - `ADMIN+` direct update: covered in Tasks 3, 4, 6.
  - visible higher-hierarchy approval rule: covered in Tasks 3 and 5.
  - one `PENDING` request per receipt: covered in Tasks 1, 2, 3, 5.
  - user-facing success message distinction: covered in Task 6.
- Placeholder scan: no `TODO/TBD` placeholders remain.
- Type consistency: `ReceiptEditablePatch`, `ReceiptEditRequestRow`, and action names are consistent across tasks.
