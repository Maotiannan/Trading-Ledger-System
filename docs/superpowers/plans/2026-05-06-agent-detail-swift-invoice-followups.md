# Agent / Detail / SWIFT / Invoice Follow-Ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scoped `PaymentAgent` master data with attachments, make `Payment Detail` editing relink receipts transactionally, rebuild `Export Pic` around a stable business template, normalize `SWIFT OCR` business fields and messages, and apply special invoice ordering for `deposit pool` / `未匹配池`.

**Architecture:** Introduce three shared backend seams before finishing page work: a scenario-aware error presentation layer, a `PaymentAgent` master-data service with uploaded-asset integration, and a `Detail` relinking/export pipeline that owns `ORDER NO` relink semantics and export `TYPE` classification. Then wire `Detail`, `SWIFT`, and `Invoice` UI/API flows to those services while preserving existing ownership, transaction, and uploaded-asset patterns.

**Tech Stack:** Next.js app router, React client components, Zustand store, Prisma/MySQL, uploaded-asset cleanup infrastructure, OCR parsing helpers, server-side image rendering (`sharp`), Jest, isolated API tests, Playwright smoke coverage.

---

## File Structure

### New / Expanded Backend Units
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/payment-agent-service.ts`
  - Scoped CRUD for `PaymentAgent` plus list/read helpers.
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/payment-agent-file-service.ts`
  - Multi-file attachment operations and uploaded-asset binding.
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/detail-relink-service.ts`
  - Preview + transactional save-time relink/create logic for detail items when `ORDER NO` changes.
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/detail-export-view-model.ts`
  - Builds export rows, totals, record count, agent footer, and `TYPE` labels.
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/business-error-presentation.ts`
  - Scenario-aware user-facing error mapping layered over `api-error-catalog`.
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/detail-export-image.ts`
  - Stop hand-rolling semantics inline; consume `DetailExportViewModel`.
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/detail-service.ts`
  - Use relink service and agent requirements on create/update.
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/swift-service.ts`
  - Normalize OCR payload and tolerate cleaned numeric/account fields.
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/ocr.ts`
  - Add `receiverAccount` cleanup helpers and stronger Block 4 parsing.
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/api-error-catalog.ts`
  - Keep transport catalog but add hooks for scenario presentation.

### API Surface
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/agent/route.ts`
  - List/create/update/upload/delete agent files.
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/detail/route.ts`
  - Agent-aware OCR confirm/create, relink preview support, export-pic rewire.
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/swift/route.ts`
  - Use scenario-aware messages and cleaned OCR payload values.

### Frontend Units
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/details/detail-manager.tsx`
  - Add `AGENT` entrypoint, agent state, and relink-aware detail editing flow.
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/details/components/agent-manager-dialog.tsx`
  - CRUD UI for scoped agents and multi-file attachments.
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/details/components/detail-upload-dialog.tsx`
  - Agent select, disabled confirm until agent selected, user-facing messages.
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/details/components/detail-edit-dialog.tsx`
  - Stable row keys, order-no preview, linked receipt labels as order numbers.
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/swifts/components/swift-upload-dialog.tsx`
  - Human-readable error handling and cleaned receiver account display.
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/invoices/hooks/use-invoice-ordering.ts`
  - `deposit pool` / `未匹配池` priority ordering.
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/details/hooks/use-detail-actions.ts`
  - Agent upload/select, relink preview, scenario error presentation.
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/swifts/hooks/use-swift-actions.ts`
  - Scenario error presentation and OCR normalization consumption.

### Data / Assets
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/prisma/schema.prisma`
  - Add `PaymentAgent`, `PaymentAgentFile`, and `Detail.agentId`.
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/prisma/migrations/<timestamp>_payment_agent_followups/migration.sql`
  - Persist new agent tables/relations.
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/public/detail-export/payment_details_template.css`
  - Frozen export styling extracted from the approved visual.
- Keep existing logo/font assets under `/Users/maotiannan/dev/docker/Trading-Ledger-System/public/detail-export/`.

### Tests
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/payment-agent-service.test.ts`
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/detail-relink-service.test.ts`
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/detail-export-view-model.test.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/detail/route.test.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/swift/route.test.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/details/detail-manager.test.tsx`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/details/hooks/use-detail-actions.test.tsx`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/swifts/hooks/use-swift-actions.test.tsx`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/invoices/hooks/use-invoice-ordering.test.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/tests/api/isolated/cases/60-receipt-detail-swift-lifecycle.case.mjs`

---

## Task 1: Lock failing tests for agent model, invoice ordering, and SWIFT message normalization

**Files:**
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/payment-agent-service.test.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/invoices/hooks/use-invoice-ordering.test.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/swift/route.test.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/swifts/hooks/use-swift-actions.test.tsx`

- [ ] **Step 1: Add a failing service test that proves agents are scoped like customers and can own multiple files**

```ts
it('lists only agents visible to the current user and preserves multiple file rows', async () => {
  mockDb.paymentAgent.findMany.mockResolvedValueOnce([
    {
      id: 'agent-1',
      companyName: 'Mitty Group',
      companyAddress: 'Conakry',
      contactName: 'Mamadou',
      contactPhone: '+224620000000',
      createdBy: 'sales-1',
      files: [
        { id: 'file-1', name: 'license.pdf', path: '/upload/files/agents/agent-1/license.pdf' },
        { id: 'file-2', name: 'registration.pdf', path: '/upload/files/agents/agent-1/registration.pdf' },
      ],
    },
  ]);

  const result = await listVisiblePaymentAgents(salesUser);

  expect(result).toHaveLength(1);
  expect(result[0].files).toHaveLength(2);
});
```

- [ ] **Step 2: Add a failing ordering test for `deposit pool` / `未匹配池` precedence**

```ts
it('keeps deposit pool and 未匹配池 above every other invoice regardless of balance', () => {
  const ordered = orderInvoicesForDisplay([
    { id: '3', invNo: 'INV-3', invBalance: 0, shipDate: '2026-05-10' } as Invoice,
    { id: '1', invNo: 'deposit pool', invBalance: 100, shipDate: null } as Invoice,
    { id: '2', invNo: '未匹配池', invBalance: 100, shipDate: null } as Invoice,
  ]);

  expect(ordered.map((row) => row.invNo)).toEqual(['deposit pool', '未匹配池', 'INV-3']);
});
```

- [ ] **Step 3: Add a failing API test for user-facing SWIFT tolerance messaging**

```ts
it('returns a localized business message when swift amount exceeds tolerance', async () => {
  mockedCreateSwiftRecord.mockRejectedValueOnce(createApiError({
    code: 'BAD_REQUEST',
    status: 400,
    message: '金额差异 49940.00 超过允许范围(±50)，无法通过验证',
  }));

  const response = await POST(new Request('http://localhost/api/swift', {
    method: 'POST',
    body: JSON.stringify({ action: 'confirm', detailId: 'detail-1', data: { amount: 101326, date: '2026-05-05' } }),
    headers: { 'content-type': 'application/json', cookie: 'locale=en' },
  }) as never, adminUser);
  const payload = await response.json();

  expect(payload.message).toBe('Amount differs too much from the selected payment detail. Record creation failed.');
});
```

- [ ] **Step 4: Add a failing hook test for receiver-account cleanup**

```ts
it('normalizes receiver account to digits only before confirm', async () => {
  await act(async () => {
    await result.current.handleConfirm({
      amount: 101326,
      date: '2026-05-05',
      senderName: 'SALAM ENTERPRISE',
      senderAddress: 'ADDRESS LINE1',
      receiverName: 'MARKET UNION CO LTD',
      receiverAccount: '/76O881488000007249',
    });
  });

  expect(apiCall).toHaveBeenCalledWith('swift', expect.objectContaining({
    data: expect.objectContaining({ receiverAccount: '760881488000007249' }),
  }));
});
```

- [ ] **Step 5: Run focused tests to lock current failures**

Run:
```bash
npm test -- --runInBand \
  src/lib/payment-agent-service.test.ts \
  src/components/workspace/modules/invoices/hooks/use-invoice-ordering.test.ts \
  src/app/api/swift/route.test.ts \
  src/components/workspace/modules/swifts/hooks/use-swift-actions.test.tsx
```

Expected:
- `payment-agent-service.test.ts` fails because service does not exist yet.
- ordering test fails because special pools are not prioritized.
- SWIFT message/account normalization assertions fail until implementation lands.

- [ ] **Step 6: Commit the red tests**

```bash
git add src/lib/payment-agent-service.test.ts \
  src/components/workspace/modules/invoices/hooks/use-invoice-ordering.test.ts \
  src/app/api/swift/route.test.ts \
  src/components/workspace/modules/swifts/hooks/use-swift-actions.test.tsx
git commit -m "test: lock agent and swift follow-up behavior"
```

## Task 2: Add `PaymentAgent` data model, scoped CRUD, and uploaded-asset-backed file attachments

**Files:**
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/prisma/schema.prisma`
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/prisma/migrations/<timestamp>_payment_agent_followups/migration.sql`
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/payment-agent-service.ts`
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/payment-agent-file-service.ts`
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/agent/route.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/uploaded-asset-service.ts`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/payment-agent-service.test.ts`

- [ ] **Step 1: Extend Prisma schema with agent and agent-file models plus nullable `Detail.agentId`**

```prisma
model PaymentAgent {
  id             String             @id @default(cuid())
  companyName    String
  companyAddress String?
  contactName    String?
  contactPhone   String?
  createdBy      String
  createdAt      DateTime           @default(now())
  updatedAt      DateTime           @updatedAt
  files          PaymentAgentFile[]
  details        Detail[]

  @@index([createdBy])
}

model PaymentAgentFile {
  id         String   @id @default(cuid())
  agentId    String
  name       String
  path       String
  mimeType   String?
  size       Int?
  uploadedBy String
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  agent      PaymentAgent @relation(fields: [agentId], references: [id], onDelete: Cascade)

  @@index([agentId])
}
```

- [ ] **Step 2: Generate the SQL migration and verify Prisma client builds**

Run:
```bash
npx prisma migrate dev --name payment_agent_followups
npx prisma generate
```

Expected:
- migration SQL created,
- Prisma client generated successfully.

- [ ] **Step 3: Implement scoped agent CRUD and visibility in `payment-agent-service.ts`**

```ts
export async function listVisiblePaymentAgents(currentUser: CurrentUser) {
  const rows = await db.paymentAgent.findMany({
    include: { files: true },
    orderBy: { companyName: 'asc' },
  });

  const visible = await filterAsync(rows, async (row) =>
    canAccessOwnedResourceAsync(row.createdBy, currentUser),
  );

  return visible;
}

export async function createPaymentAgent(currentUser: CurrentUser, input: PaymentAgentInput) {
  return db.paymentAgent.create({
    data: {
      companyName: input.companyName.trim(),
      companyAddress: input.companyAddress?.trim() || null,
      contactName: input.contactName?.trim() || null,
      contactPhone: input.contactPhone?.trim() || null,
      createdBy: currentUser.id,
    },
  });
}
```

- [ ] **Step 4: Implement multi-file attachment helpers with uploaded-asset binding**

```ts
export async function attachPaymentAgentFile(params: {
  currentUser: CurrentUser;
  agentId: string;
  uploadedPath: string;
  uploadedName: string;
  mimeType?: string | null;
  size?: number | null;
}) {
  const agent = await getAccessiblePaymentAgent(params.agentId, params.currentUser);
  const file = await db.paymentAgentFile.create({
    data: {
      agentId: agent.id,
      name: params.uploadedName,
      path: params.uploadedPath,
      mimeType: params.mimeType || null,
      size: params.size ?? null,
      uploadedBy: params.currentUser.id,
    },
  });
  await attachUploadedAssetByPath({
    path: params.uploadedPath,
    attachmentType: UploadedAssetAttachmentType.PAYMENT_AGENT_FILE,
    attachmentId: file.id,
  });
  return file;
}
```

- [ ] **Step 5: Expose agent CRUD/file operations under `/api/agent`**

```ts
if (action === 'list') {
  const agents = await listVisiblePaymentAgents(currentUser);
  return createApiSuccessResponse({ data: agents }, request);
}

if (action === 'create') {
  const agent = await createPaymentAgent(currentUser, parsePaymentAgentInput(body.data ?? body));
  return createApiSuccessResponse({ data: agent, message: 'Agent created' }, request);
}
```

- [ ] **Step 6: Run focused tests**

Run:
```bash
npx prisma generate
npm test -- --runInBand src/lib/payment-agent-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations \
  src/lib/payment-agent-service.ts \
  src/lib/payment-agent-file-service.ts \
  src/app/api/agent/route.ts \
  src/lib/uploaded-asset-service.ts \
  src/lib/payment-agent-service.test.ts
git commit -m "feat: add scoped payment agent master data"
```

## Task 3: Add scenario-aware business error presentation and SWIFT normalization

**Files:**
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/business-error-presentation.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/api-error-catalog.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/ocr.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/swift/route.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/swifts/hooks/use-swift-actions.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/swifts/components/swift-upload-dialog.tsx`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/swift/route.test.ts`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/swifts/hooks/use-swift-actions.test.tsx`

- [ ] **Step 1: Add a scenario-aware presenter for user-facing errors**

```ts
export function presentBusinessError(params: {
  locale: SupportedLocale;
  scenario: 'swift-upload' | 'detail-upload' | 'detail-edit' | 'receipt-direct';
  code?: string | null;
  message?: string | null;
}) {
  if (params.scenario === 'swift-upload' && /金额差异 .* 超过允许范围/.test(params.message || '')) {
    return params.locale === 'zh'
      ? '与 payment details 金额差异过大，录入失败'
      : 'Amount differs too much from the selected payment detail. Record creation failed.';
  }
  if ((params.message || '').includes('received NaN')) {
    return params.locale === 'zh'
      ? '录入内容无效，请检查金额和必填字段'
      : 'Invalid input. Please check numeric and required fields.';
  }
  return translateApiErrorCode(params.code, params.message || '', params.locale);
}
```

- [ ] **Step 2: Add SWIFT OCR cleanup helpers for account and amount fields**

```ts
export function normalizeSwiftReceiverAccount(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/[oO]/g, '0')
    .replace(/\s+/g, '')
    .replace(/\D+/g, '') || null;
}

export function normalizeSwiftAmountInput(value: string | number | null | undefined) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value ?? '').replace(/[, ]+/g, '').trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}
```

- [ ] **Step 3: Use the normalization helpers before SWIFT schema parsing and persistence**

```ts
const payload = {
  ...rawPayload,
  amount: normalizeSwiftAmountInput(rawPayload.amount),
  receiverAccount: normalizeSwiftReceiverAccount(rawPayload.receiverAccount),
  senderName: trimOrNull(rawPayload.senderName),
  senderAddress: trimOrNull(rawPayload.senderAddress),
  receiverName: trimOrNull(rawPayload.receiverName),
};

if (payload.amount == null) {
  throw createApiError({ code: 'BAD_REQUEST', status: 400, message: '汇款金额无效' });
}
```

- [ ] **Step 4: Use the scenario presenter in the SWIFT hook so dialogs never show raw schema text**

```ts
const errorMessage = presentBusinessError({
  locale,
  scenario: 'swift-upload',
  code: result.error?.code ?? null,
  message: result.error?.message ?? tx('操作失败', 'Operation failed'),
});
setError(errorMessage);
```

- [ ] **Step 5: Add receiver-account cleanup to OCR result shaping**

```ts
setOcrResult({
  ...ocrResult,
  receiverAccount: normalizeSwiftReceiverAccount(result.data.ocrResult.receiverAccount),
});
```

- [ ] **Step 6: Run focused tests**

Run:
```bash
npm test -- --runInBand \
  src/app/api/swift/route.test.ts \
  src/components/workspace/modules/swifts/hooks/use-swift-actions.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/business-error-presentation.ts \
  src/lib/api-error-catalog.ts \
  src/lib/ocr.ts \
  src/app/api/swift/route.ts \
  src/components/workspace/modules/swifts/hooks/use-swift-actions.ts \
  src/components/workspace/modules/swifts/components/swift-upload-dialog.tsx
git commit -m "feat: humanize swift errors and normalize ocr fields"
```

## Task 4: Make `Detail` editing relink receipts transactionally and require agents for OCR confirm

**Files:**
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/detail-relink-service.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/detail-service.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/detail/route.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/details/detail-manager.tsx`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/details/components/detail-edit-dialog.tsx`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/details/components/detail-upload-dialog.tsx`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/details/hooks/use-detail-actions.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/details/components/detail-list.tsx`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/detail-relink-service.test.ts`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/details/detail-manager.test.tsx`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/details/hooks/use-detail-actions.test.tsx`

- [ ] **Step 1: Add relink service tests for existing-receipt relink and save-time new receipt creation**

```ts
it('relinks a detail item to an existing receipt when orderNo changes to a known order', async () => {
  mockFindMatchingReceipt.mockResolvedValueOnce('receipt-2');

  const result = await relinkDetailItemsOnSave({
    tx: mockTx,
    currentUser: adminUser,
    items: [{ mark: 'OLD', orderNo: 'NEW-01', amount: 120, receiptId: 'receipt-1' }],
  });

  expect(result.items[0].receiptId).toBe('receipt-2');
});

it('creates a new receipt on save when no linked receipt exists for the edited order number', async () => {
  mockFindMatchingReceipt.mockResolvedValueOnce(null);
  mockReceiptCreate.mockResolvedValueOnce({ id: 'receipt-new', orderNo: 'NEW-02' });

  const result = await relinkDetailItemsOnSave({ ... });

  expect(result.items[0].receiptId).toBe('receipt-new');
});
```

- [ ] **Step 2: Implement `detail-relink-service.ts` as the only place that decides relink vs create**

```ts
export async function relinkDetailItemsOnSave(params: RelinkParams) {
  const nextItems: ProcessedDetailItem[] = [];
  for (const item of params.items) {
    const normalizedOrderNo = trimOrNull(item.orderNo);
    const matchedReceiptId = normalizedOrderNo ? await findMatchingReceipt(normalizedOrderNo, item.amount) : null;

    if (matchedReceiptId) {
      nextItems.push(await bindExistingReceipt(params.tx, matchedReceiptId, item));
      continue;
    }

    if (normalizedOrderNo) {
      nextItems.push(await createReceiptForDetailItem(params.tx, params.currentUser, item));
      continue;
    }

    nextItems.push({ ...item, receiptId: null, linkedReceiptOrderNo: null });
  }
  return { items: nextItems };
}
```

- [ ] **Step 3: Refactor `detail-service.ts` to call the relink service on update and OCR confirm**

```ts
const relinked = await relinkDetailItemsOnSave({
  tx,
  currentUser,
  items: normalizeItems(payload),
  imagePath,
  imageName,
});

await tx.detailItem.deleteMany({ where: { detailId } });
await tx.detailItem.createMany({
  data: relinked.items.map((item) => ({
    detailId,
    mark: item.mark,
    orderNo: item.orderNo,
    amount: item.amount,
    receiptId: item.receiptId,
  })),
});
```

- [ ] **Step 4: Make `DetailEditDialog` keep stable row keys and show linked receipt order numbers only**

```tsx
type DetailEditRowDraft = DetailEditablePatch['items'][number] & { key: string; linkedReceiptOrderNo: string | null; };

<div key={item.key} className="grid grid-cols-1 gap-3 rounded-md border p-3 md:grid-cols-4">
  <Input value={item.orderNo ?? ''} onChange={(e) => updateItem(item.key, { orderNo: e.target.value || null })} />
  <div className="min-h-10 rounded-md border px-3 py-2 text-sm">
    {item.linkedReceiptOrderNo || tx('未匹配', 'Unmatched')}
  </div>
</div>
```

- [ ] **Step 5: Add debounced preview resolution and agent requirement in upload dialog actions**

```ts
const [selectedAgentId, setSelectedAgentId] = useState('');
const canConfirm = Boolean(ocrResult) && Boolean(selectedAgentId) && !submitting && !uploading;

useDebouncedEffect(() => {
  void previewRelinkDraft(editDraft.items);
}, [editDraft.items], 250);
```

- [ ] **Step 6: Add the `AGENT` management button and dialog shell in `detail-manager.tsx`**

```tsx
<Button variant="outline" onClick={() => setShowAgentManager(true)}>
  {tx('AGENT', 'AGENT')}
</Button>
<AgentManagerDialog
  open={showAgentManager}
  agents={agents}
  onCreateAgent={handleCreateAgent}
  onUploadAgentFile={handleUploadAgentFile}
  onOpenChange={setShowAgentManager}
/>
```

- [ ] **Step 7: Run focused tests**

Run:
```bash
npm test -- --runInBand \
  src/lib/detail-relink-service.test.ts \
  src/components/workspace/modules/details/detail-manager.test.tsx \
  src/components/workspace/modules/details/hooks/use-detail-actions.test.tsx \
  src/app/api/detail/route.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/detail-relink-service.ts \
  src/lib/detail-service.ts \
  src/app/api/detail/route.ts \
  src/components/workspace/modules/details/detail-manager.tsx \
  src/components/workspace/modules/details/components/detail-edit-dialog.tsx \
  src/components/workspace/modules/details/components/detail-upload-dialog.tsx \
  src/components/workspace/modules/details/hooks/use-detail-actions.ts \
  src/components/workspace/modules/details/components/detail-list.tsx \
  src/lib/detail-relink-service.test.ts \
  src/components/workspace/modules/details/detail-manager.test.tsx \
  src/components/workspace/modules/details/hooks/use-detail-actions.test.tsx
git commit -m "feat: relink detail order changes and require agents"
```

## Task 5: Rebuild `Export Pic` around a view model and frozen template semantics

**Files:**
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/detail-export-view-model.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/detail-export-image.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/detail-export-image.test.ts`
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/detail-export-view-model.test.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/detail/route.test.ts`
- Reuse: `/Users/maotiannan/dev/docker/Trading-Ledger-System/public/detail-export/payment-detail-logo.png`

- [ ] **Step 1: Add a failing view-model test that codifies totals, footer, and `TYPE` rules**

```ts
it('builds export rows with Initial, Final, and Std type labels plus agent footer', async () => {
  const model = await buildDetailExportViewModel({
    id: 'detail-1',
    date: '2026-05-04',
    agent: { companyName: 'Mitty Group' },
    items: [
      { mark: 'Simagan', orderNo: 'Simagan-07', amount: 5277 },
      { mark: 'Sabou', orderNo: 'Sabou-01', amount: 3003 },
    ],
  });

  expect(model.footerLabel).toBe('Mitty Group · Disbursement');
  expect(model.totalAmountText).toBe('$8,280');
  expect(model.recordsText).toBe('2 records');
});
```

- [ ] **Step 2: Implement `detail-export-view-model.ts` to own all export semantics**

```ts
export async function buildDetailExportViewModel(detail: DetailExportSource): Promise<DetailExportViewModel> {
  const rows = await Promise.all(detail.items.map(async (item, index) => ({
    index: index + 1,
    mark: item.mark ?? '-',
    orderNo: item.orderNo ?? '-',
    type: await classifyDetailExportType(item.orderNo, detail.id),
    amountText: `$${formatAmount(item.amount)}`,
  })));

  const total = rows.reduce((sum, row) => sum + parseCurrency(row.amountText), 0);
  return {
    dateText: formatSheetDate(detail.date),
    totalAmountText: `$${formatAmount(total)}`,
    transactionCountText: String(rows.length),
    rows,
    footerLabel: `${detail.agent?.companyName ?? 'Mitty Group'} · Disbursement`,
    recordsText: `${rows.length} records`,
  };
}
```

- [ ] **Step 3: Rewrite `detail-export-image.ts` to consume the view model instead of inline type/note guesses**

```ts
export async function renderDetailExportJpeg(detail: DetailExportRecord) {
  const model = await buildDetailExportViewModel(detail);
  const svg = buildDetailExportSvgFromViewModel(model);
  return sharp(Buffer.from(svg))
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer();
}
```

- [ ] **Step 4: Update tests to assert readable fields instead of tofu/placeholder semantics**

```ts
expect(svg).toContain('MU Group');
expect(svg).toContain('TOTAL TRANSFERRED');
expect(svg).toContain('Mitty Group · Disbursement');
expect(svg).toContain('Simagan-07');
```

- [ ] **Step 5: Run focused tests**

Run:
```bash
npm test -- --runInBand \
  src/lib/detail-export-view-model.test.ts \
  src/lib/detail-export-image.test.ts \
  src/app/api/detail/route.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/detail-export-view-model.ts \
  src/lib/detail-export-image.ts \
  src/lib/detail-export-image.test.ts \
  src/lib/detail-export-view-model.test.ts \
  src/app/api/detail/route.test.ts
git commit -m "feat: rebuild payment detail export around view model"
```

## Task 6: Finish invoice ordering and wire final documentation/tests

**Files:**
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/invoices/hooks/use-invoice-ordering.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/tests/api/isolated/cases/60-receipt-detail-swift-lifecycle.case.mjs`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/README.md`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/todolist.md`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/ENGINEERING_LOG.md`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/package.json`

- [ ] **Step 1: Add special-pool detection to invoice ordering**

```ts
function invoicePriority(invNo: string) {
  const normalized = invNo.trim().toLowerCase();
  if (normalized === 'deposit pool') return 0;
  if (invNo.trim() === '未匹配池') return 1;
  return 2;
}

export function orderInvoicesForDisplay(invoices: Invoice[]) {
  return [...invoices].sort((left, right) => {
    const leftPriority = invoicePriority(left.invNo);
    const rightPriority = invoicePriority(right.invNo);
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    // existing outstanding + shipDate ordering continues here
  });
}
```

- [ ] **Step 2: Extend the isolated API lifecycle case so detail OCR + swift OCR covers agent-required confirm and cleaned receiver account**

```js
assert.equal(swift.receiverAccount, '76881488000007249');
assert.equal(detail.agent.companyName, 'Mitty Group');
assert.match(swiftError.message, /payment detail/i);
```

- [ ] **Step 3: Bump version and document the new behavior**

```json
{
  "version": "1.0.119"
}
```

```md
- Payment Agent master data added to Payment Detail Management with scoped visibility and multi-file attachments.
- Edit Payment Detail now previews/relinks linked receipts by order number and creates missing receipts transactionally on save.
- SWIFT OCR now cleans receiver accounts and returns business-readable error messages.
- Invoice Management now pins deposit pool and 未匹配池 above normal invoice ordering.
```

- [ ] **Step 4: Run full verification**

Run:
```bash
npm run build
npm run test:ci
docker compose up -d --build
curl -k -I https://localhost | head -n 1
```

Expected:
- build passes,
- all Jest / isolated API / isolated Playwright suites pass,
- local HTTPS returns `HTTP/2 200`.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/modules/invoices/hooks/use-invoice-ordering.ts \
  tests/api/isolated/cases/60-receipt-detail-swift-lifecycle.case.mjs \
  package.json README.md todolist.md ENGINEERING_LOG.md
git commit -m "feat: finish agent detail swift and invoice follow-ups"
```

---

## Self-Review

### Spec Coverage
- Human-readable error presentation: Task 3
- Scoped `PaymentAgent` + multi-file attachments: Task 2
- `ORDER NO` cursor stability + linked receipt relink/create: Task 4
- `Export Pic` with date/summary/table/footer and `TYPE` rules: Task 5
- SWIFT receiver-account cleanup and amount normalization: Task 3
- Invoice special-pool priority ordering: Task 6

No spec section is left without a task.

### Placeholder Scan
- No `TODO`/`TBD`
- Every task includes exact files, code snippets, commands, expected outcomes
- No “similar to previous task” placeholders

### Type Consistency
- `PaymentAgent` / `PaymentAgentFile` are used consistently across schema, service, and API tasks
- `DetailExportViewModel` is introduced before template rendering consumes it
- `relinkDetailItemsOnSave()` is defined before route/service integration tasks refer to it

