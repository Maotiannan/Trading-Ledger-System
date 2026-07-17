# Dashboard / Payment Detail / SWIFT UX Hardening Implementation Plan

> **Plan status:** `ARCHIVED_COMPLETED` as of 2026-07-17. The implementation is on `main`; unchecked boxes below are retained as the original execution checklist and are not active backlog. See [the status index](./README.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove inter-page data-loading dependencies, fix SWIFT OCR confirm/create correctness, make detail/SWIFT dialogs mobile-safe, and switch payment detail export to the provided HTML template rendered as JPG.

**Architecture:** Add focused read paths instead of global warm-up dependencies, move payment detail export to a frozen HTML-template render pipeline, parse SWIFT business fields from Block 4 instead of transport header fields, and standardize narrow-screen dialog behavior with scrollable bodies plus sticky footers. Keep changes localized to dashboard/detail/swift modules and their APIs so the rest of the workspace remains stable.

**Tech Stack:** Next.js app router, Zustand store, Prisma/MySQL, existing OCR service wrappers, server-side HTML/image rendering, Jest, isolated API tests, isolated Playwright E2E.

---

## Task 1: Lock failing tests for SWIFT confirm/create and OCR field mapping

**Files:**
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/swift/route.test.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/swifts/hooks/use-swift-actions.test.tsx`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/tests/api/isolated/cases/60-receipt-detail-swift-lifecycle.case.mjs`

- [ ] **Step 1: Add a route test that proves confirm/create rejects `NaN` cleanly instead of surfacing schema noise**

```ts
it('returns a business validation error when confirm payload amount is empty or invalid', async () => {
  mockedParseActionRequest.mockResolvedValue({
    action: 'confirm',
    data: {
      detailId: 'detail-1',
      data: { amount: '', date: '2026-05-05', senderName: 'SALAM ENTERPRISE', senderAddress: 'ADDRESS LINE1', receiverName: 'MARKET UNION CO LTD', receiverAccount: '76881488000007249' },
      imagePath: '/upload/swift.jpg',
      imageName: 'swift.jpg',
    },
    file: null,
  });

  const response = await POST(new Request('http://localhost/api/swift', { method: 'POST' }) as never, adminUser);
  const payload = await response.json();

  expect(response.status).toBe(400);
  expect(payload.success).toBe(false);
  expect(payload.message).toMatch(/金额|amount/i);
});
```

- [ ] **Step 2: Add a service/hook test that asserts OCR result uses Block 4 business fields, not header BIC values**

```ts
it('maps Block 4 sender/receiver business fields into the OCR form state', async () => {
  fetchMock.mockResolvedValueOnce({
    success: true,
    data: {
      ocrResult: {
        amount: 51386,
        date: '2026-05-01',
        senderName: 'SALAM ENTERPRISE',
        senderAddress: 'ADDRESS LINE1\n1000 MONROVIA 10 LIBERIA',
        receiverName: 'MARKET UNION CO LTD',
        receiverAccount: '76881488000007249',
      },
      image: { path: '/upload/swift.jpg', name: 'swift.jpg' },
    },
  });

  await act(async () => {
    await result.current.handleFileSelect(fileEvent(sampleSwiftImageFile));
  });

  expect(setOcrResult).toHaveBeenCalledWith(expect.objectContaining({
    senderName: 'SALAM ENTERPRISE',
    receiverName: 'MARKET UNION CO LTD',
    receiverAccount: '76881488000007249',
  }));
});
```

- [ ] **Step 3: Add isolated API assertions for SWIFT OCR confirm on the sample field shape**

Run: `npm run test:api:isolated -- --case 60-receipt-detail-swift-lifecycle`

Expected: FAIL in SWIFT confirm/create or field assertions until implementation is updated.

- [ ] **Step 4: Commit the test lock-in**

```bash
git add src/app/api/swift/route.test.ts \
  src/components/workspace/modules/swifts/hooks/use-swift-actions.test.tsx \
  tests/api/isolated/cases/60-receipt-detail-swift-lifecycle.case.mjs
git commit -m "test: lock swift confirm and block4 mapping behavior"
```

## Task 2: Normalize SWIFT OCR confirm payload and Block 4 mapping

**Files:**
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/swift/route.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/swift-service.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/swifts/types.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/swifts/hooks/use-swift-actions.ts`

- [ ] **Step 1: Add a coercion helper in `route.ts` that turns nested confirm payloads into safe SWIFT payload values**

```ts
function parseSwiftCreatePayload(data: Record<string, unknown>) {
  const raw = (data.data ?? data) as Record<string, unknown>;
  const normalized = {
    ...raw,
    amount: raw.amount === '' || raw.amount == null ? null : Number(raw.amount),
  };

  if (normalized.amount == null || Number.isNaN(normalized.amount)) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: '汇款金额无效',
    });
  }

  return parseSwiftPayloadValue(normalized);
}
```

- [ ] **Step 2: Use the helper in `confirm` and `direct-create` instead of parsing raw request data directly**

```ts
if (action === 'confirm' || action === 'direct-create') {
  const payload = parseSwiftCreatePayload(requestData);
  const result = await createSwiftRecord({
    currentUser,
    detailId: typeof requestData.detailId === 'string' ? requestData.detailId : '',
    payload,
    imagePath: typeof requestData.imagePath === 'string' ? requestData.imagePath : null,
    imageName: typeof requestData.imageName === 'string' ? requestData.imageName : null,
    mode: action,
  });
  return createApiSuccessResponse({ data: { swift: result.swift, validation: result.validation }, message: result.message }, request);
}
```

- [ ] **Step 3: Expand the SWIFT OCR result shape to include sender address and receiver account explicitly**

```ts
export type SwiftOcrResult = {
  amount?: number | null;
  date?: string | null;
  senderName?: string | null;
  senderAddress?: string | null;
  receiverName?: string | null;
  receiverAccount?: string | null;
};
```

- [ ] **Step 4: Change OCR result mapping in `use-swift-actions.ts` to preserve those fields end-to-end**

```ts
if (result.success) {
  setOcrResult({
    amount: result.data.ocrResult.amount ?? null,
    date: result.data.ocrResult.date ?? null,
    senderName: result.data.ocrResult.senderName ?? null,
    senderAddress: result.data.ocrResult.senderAddress ?? null,
    receiverName: result.data.ocrResult.receiverName ?? null,
    receiverAccount: result.data.ocrResult.receiverAccount ?? null,
  });
}
```

- [ ] **Step 5: Update the OCR service logic so UI/business fields come from Block 4 markers (`:50K:` and `:59:`), not header BIC sender/receiver**

```ts
const messageText = extractBlock4Text(rawOcrText);
const senderBlock = extractSwiftFieldBlock(messageText, ':50K:');
const receiverBlock = extractSwiftFieldBlock(messageText, ':59:');

return {
  amount,
  date,
  senderName: senderBlock.name,
  senderAddress: senderBlock.address,
  receiverName: receiverBlock.name,
  receiverAccount: receiverBlock.account,
};
```

- [ ] **Step 6: Run focused tests**

Run:
- `npm test -- --runInBand src/app/api/swift/route.test.ts src/components/workspace/modules/swifts/hooks/use-swift-actions.test.tsx`
- `npm run test:api:isolated -- --case 60-receipt-detail-swift-lifecycle`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/swift/route.ts \
  src/lib/swift-service.ts \
  src/components/workspace/modules/swifts/types.ts \
  src/components/workspace/modules/swifts/hooks/use-swift-actions.ts
git commit -m "fix: normalize swift confirm payload and block4 fields"
```

## Task 3: Add mobile-safe sticky-footer dialog shells for Detail and SWIFT

**Files:**
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/details/components/detail-upload-dialog.tsx`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/swifts/components/swift-upload-dialog.tsx`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/details/components/detail-edit-dialog.tsx`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/details/hooks/use-detail-actions.test.tsx`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/swifts/hooks/use-swift-actions.test.tsx`

- [ ] **Step 1: Restructure the detail upload dialog into a max-height shell with scrollable body and sticky footer**

```tsx
<DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden p-0">
  <DialogHeader className="px-6 pt-6">...</DialogHeader>
  <div className="max-h-[calc(90vh-9rem)] overflow-y-auto px-6 py-4 space-y-4">
    {/* form content */}
  </div>
  <DialogFooter className="sticky bottom-0 border-t bg-background px-6 py-4">
    {/* buttons */}
  </DialogFooter>
</DialogContent>
```

- [ ] **Step 2: Apply the same shell pattern to the SWIFT upload dialog and include the new OCR fields**

```tsx
<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
  <Input value={ocrResult.senderName || ''} ... />
  <Input value={ocrResult.senderAddress || ''} ... />
  <Input value={ocrResult.receiverName || ''} ... />
  <Input value={ocrResult.receiverAccount || ''} ... />
</div>
```

- [ ] **Step 3: Apply a mobile-safe shell to `DetailEditDialog` and remove footer overflow risk**

```tsx
<DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-hidden p-0">
  <div className="max-h-[calc(90vh-9rem)] overflow-y-auto px-6 py-4">...</div>
  <DialogFooter className="sticky bottom-0 border-t bg-background px-6 py-4" />
</DialogContent>
```

- [ ] **Step 4: Add or update tests that verify the new OCR fields render and the dialogs remain actionable**

```ts
expect(screen.getByLabelText(/付款人地址|Sender Address/i)).toBeInTheDocument();
expect(screen.getByRole('button', { name: /确认创建|Confirm Create/i })).toBeEnabled();
```

- [ ] **Step 5: Run focused tests**

Run:
- `npm test -- --runInBand src/components/workspace/modules/details/hooks/use-detail-actions.test.tsx src/components/workspace/modules/swifts/hooks/use-swift-actions.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/workspace/modules/details/components/detail-upload-dialog.tsx \
  src/components/workspace/modules/swifts/components/swift-upload-dialog.tsx \
  src/components/workspace/modules/details/components/detail-edit-dialog.tsx \
  src/components/workspace/modules/details/hooks/use-detail-actions.test.tsx \
  src/components/workspace/modules/swifts/hooks/use-swift-actions.test.tsx
git commit -m "fix: harden detail and swift dialogs for mobile"
```

## Task 4: Remove raw internal IDs from Edit Payment Detail

**Files:**
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/details/components/detail-edit-dialog.tsx`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/details/detail-manager.tsx`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/details/detail-manager.test.tsx`

- [ ] **Step 1: Replace raw `receiptId` editing with a human-readable linked receipt label or hide it entirely**

```tsx
<div className="space-y-1">
  <Label>{tx('关联收据', 'Linked Receipt')}</Label>
  <div className="text-sm text-muted-foreground">
    {linkedReceiptLabel ?? tx('未关联收据', 'No linked receipt')}
  </div>
</div>
```

- [ ] **Step 2: Prepare readable labels in `detail-manager.tsx` when opening the edit dialog**

```ts
const linkedReceiptLabel = item.receipt
  ? [item.receipt.receiptNo, item.receipt.orderNo, `$${item.receipt.usd.toFixed(2)}`].filter(Boolean).join(' / ')
  : null;
```

- [ ] **Step 3: Add a regression test proving raw `cmos...` IDs are not rendered in the dialog**

```ts
expect(screen.queryByText(/cmos[a-z0-9]+/i)).not.toBeInTheDocument();
expect(screen.getByText(/未关联收据|No linked receipt/i)).toBeInTheDocument();
```

- [ ] **Step 4: Run focused test**

Run: `npm test -- --runInBand src/components/workspace/modules/details/detail-manager.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/modules/details/components/detail-edit-dialog.tsx \
  src/components/workspace/modules/details/detail-manager.tsx \
  src/components/workspace/modules/details/detail-manager.test.tsx
git commit -m "fix: hide internal ids in detail edit dialog"
```

## Task 5: Decouple dashboard and SWIFT detail selection from prior page visits

**Files:**
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/dashboard/dashboard-view.tsx`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/swifts/swift-manager.tsx`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/detail/route.ts`
- Optionally create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/dashboard-read-service.ts`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/detail/route.test.ts`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/tests/e2e/dashboard-report.spec.ts`

- [ ] **Step 1: Add a small read path for selectable details in `/api/detail`**

```ts
if (action === 'selectable-for-swift') {
  const rows = await db.detail.findMany({
    where: {
      ...buildDetailVisibilityWhere(ownerIds),
      status: DetailStatus.Waiting_SWIFT,
    },
    select: {
      id: true,
      date: true,
      totalAmount: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ success: true, data: rows });
}
```

- [ ] **Step 2: Load selectable details when the SWIFT upload dialog opens instead of relying on store warm-up**

```ts
useEffect(() => {
  if (!showUpload || waitingDetails.length > 0) return;
  void loadSelectableDetails();
}, [showUpload, waitingDetails.length, loadSelectableDetails]);
```

- [ ] **Step 3: Add a dashboard-local summary fetch so dashboard does not depend on other modules being visited**

```ts
const [recentReceipts, setRecentReceipts] = useState<ReceiptSummary[]>([]);
const [recentDetails, setRecentDetails] = useState<DetailSummary[]>([]);

useEffect(() => {
  void loadDashboardSummary();
}, [loadDashboardSummary]);
```

- [ ] **Step 4: Add tests proving `selectable-for-swift` returns data and dashboard remains populated independently**

```ts
expect(payload.data).toEqual([
  expect.objectContaining({ id: 'detail-1', totalAmount: 101326 }),
]);
```

- [ ] **Step 5: Run focused tests**

Run:
- `npm test -- --runInBand src/app/api/detail/route.test.ts`
- `npm run test:e2e:isolated`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/workspace/modules/dashboard/dashboard-view.tsx \
  src/components/workspace/modules/swifts/swift-manager.tsx \
  src/app/api/detail/route.ts \
  src/app/api/detail/route.test.ts \
  tests/e2e/dashboard-report.spec.ts
git commit -m "fix: decouple dashboard and swift detail loading"
```

## Task 6: Replace Payment Detail export rendering with the provided HTML template and JPG output

**Files:**
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/detail-export-image.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/detail/route.ts`
- Add template asset or reference adapter derived from: `/Users/maotiannan/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_lxvqd3ajorad22_6b62/temp/drag/payment_details.html`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/detail-export-image.test.ts`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/detail/route.test.ts`

- [ ] **Step 1: Freeze the HTML template into a render helper with placeholders for title, rows, and total**

```ts
export function buildDetailExportHtml(detail: DetailExportRecord) {
  const rows = detail.items.map((item, index) => ({
    index: index + 1,
    mark: item.mark ?? '-',
    amount: formatAmount(item.amount),
    description: item.orderNo ? `Payment for ${item.orderNo}` : 'Payment',
  }));

  return paymentDetailsTemplate
    .replace('__TITLE__', escapeHtml(title))
    .replace('__ROWS__', rows.map(renderRowHtml).join(''))
    .replace('__TOTAL__', escapeHtml(`Total amount transferred $${formatAmount(totalAmount)}#`));
}
```

- [ ] **Step 2: Render the HTML to JPG on the server instead of PNG/SVG text drawing**

```ts
export async function renderDetailExportJpg(detail: DetailExportRecord) {
  const html = buildDetailExportHtml(detail);
  const image = await renderHtmlToImage({ html, width: 1280, type: 'jpeg', quality: 90 });
  return image;
}
```

- [ ] **Step 3: Update `/api/detail?action=export-pic` to return JPG metadata**

```ts
return new NextResponse(new Uint8Array(buffer), {
  status: 200,
  headers: {
    'Content-Type': 'image/jpeg',
    'Content-Disposition': `attachment; filename="payment-detail-${fileDate}-${detail.id}.jpg"`,
    'Cache-Control': 'no-store',
  },
});
```

- [ ] **Step 4: Add tests that assert the output is JPEG and non-empty**

```ts
expect(response.headers.get('content-type')).toBe('image/jpeg');
expect(buffer.byteLength).toBeGreaterThan(1000);
```

- [ ] **Step 5: Run focused tests**

Run:
- `npm test -- --runInBand src/lib/detail-export-image.test.ts src/app/api/detail/route.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/detail-export-image.ts src/app/api/detail/route.ts src/lib/detail-export-image.test.ts src/app/api/detail/route.test.ts
git commit -m "feat: render payment detail exports from html template"
```

## Task 7: Full verification, version sync, docs, Docker, and git integration

**Files:**
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/package.json`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/README.md`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/todolist.md`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/ENGINEERING_LOG.md`

- [ ] **Step 1: Bump version and document the new dashboard/detail/swift behavior**

```json
{
  "version": "1.0.117"
}
```

Update docs to mention:
- dashboard no longer depends on visiting other pages,
- SWIFT detail select is dialog-local,
- SWIFT OCR now uses `:50K:` / `:59:` business fields,
- payment detail export uses the provided template and JPG output,
- detail/swift mobile dialogs now keep footer actions reachable.

- [ ] **Step 2: Run full verification**

Run:
- `npm run build`
- `npm run test:ci`

Expected:
- build succeeds
- Jest passes
- isolated API passes
- isolated Playwright passes

- [ ] **Step 3: Rebuild local Docker service**

Run:
- `docker compose up -d --build`
- `curl -k -I https://localhost | head -n 1`
- `docker exec trading-ledger-system-app-1 node -p "require('./package.json').version"`

Expected:
- local HTTPS `200`
- container version matches bumped version

- [ ] **Step 4: Commit**

```bash
git add package.json README.md todolist.md ENGINEERING_LOG.md
git commit -m "chore: sync docs and version for dashboard/detail/swift ux hardening"
```

- [ ] **Step 5: Push and report**

```bash
git push origin main
```

Expected:
- remote branch updated
- record GitHub Actions run URL/status for the final handoff
