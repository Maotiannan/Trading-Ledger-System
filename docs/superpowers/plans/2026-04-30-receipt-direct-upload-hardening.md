# Receipt Direct Upload Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Receipt Management -> Create Receipt Directly` more reliable on weak mobile networks by adding client-side compression, explicit upload feedback, richer order-context autofill, and mobile-friendly image picking while preserving the existing protected upload API and NAS storage path.

**Architecture:** Keep the current `/api/upload-image` and `receipt direct-create` business flow, but add a pre-upload client compression layer, richer order-context data, and a small UI state machine for upload feedback. Extend the existing invoice/customer context lookup instead of creating a second lookup API, and strengthen observability by classifying upload failures at the API boundary and mapping them to explicit UI messages.

**Tech Stack:** Next.js App Router, React hooks, TypeScript, Jest, Playwright, existing protected `/api/upload-image` endpoint, NAS-backed upload storage.

---

## File Structure

**Create:**
- `src/components/workspace/modules/receipts/utils/image-compression.ts`
- `src/components/workspace/modules/receipts/utils/image-compression.test.ts`

**Modify:**
- `src/components/workspace/api/client.ts`
- `src/components/workspace/modules/receipts/types.ts`
- `src/components/workspace/modules/receipts/components/receipt-direct-create-dialog.tsx`
- `src/components/workspace/modules/receipts/hooks/use-receipt-forms.ts`
- `src/components/workspace/modules/receipts/hooks/use-receipt-actions.ts`
- `src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx`
- `src/app/api/upload-image/route.ts`
- `src/lib/invoice-read-service.ts`
- `src/lib/invoice-read-service.test.ts`
- `tests/e2e/receipt-generator.spec.ts` or a receipt-management Playwright file if a better receipt direct-create home already exists
- `README.md`
- `todolist.md`
- `ENGINEERING_LOG.md`
- `package.json`
- `package-lock.json`

**Rationale:**
- Compression logic gets its own focused utility so it stays testable and reusable.
- Direct-create dialog remains presentational; upload state and order-context logic stay in hooks.
- Existing `lookupOrderContextByOrderNo(...)` in `client.ts` is extended so `INV NO / MARK / PHONE / PAYER` stay in one suggestion path.
- Server upload route keeps the same endpoint but improves error classification and response details.

### Task 1: Extend Order Context Contract for `phone` and `payer`

**Files:**
- Modify: `src/lib/invoice-read-service.ts`
- Modify: `src/components/workspace/api/client.ts`
- Test: `src/lib/invoice-read-service.test.ts`

- [ ] **Step 1: Write the failing service tests**

```ts
it('returns phone and payer suggestion from the latest exact invoice customer', async () => {
  const result = await getOrderContextByOrderNo({
    orderNo: 'MAB-1-10',
    ownerIds: ['owner-1'],
  });

  expect(result.latestExactMatch?.customerPhone).toBe('622 49 12 86');
  expect(result.latestExactMatch?.customerPayer).toBe('MAB SARL');
});

it('falls back payer suggestion from customer name when company name is empty', async () => {
  const result = await getOrderContextByOrderNo({
    orderNo: 'MAB-1-11',
    ownerIds: ['owner-1'],
  });

  expect(result.latestExactMatch?.customerPayer).toBe('Mamadou Diallo');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand src/lib/invoice-read-service.test.ts`
Expected: FAIL because `customerPhone` / `customerPayer` are not returned yet.

- [ ] **Step 3: Implement minimal service changes**

```ts
// inside exact match row shaping
customerPhone: order.customerPhone || order.customer?.phone || null,
customerPayer: order.customer?.companyName?.trim()
  ? order.customer.companyName.trim()
  : (order.customer?.name?.trim() || null),
```

Also include those fields in the API-facing exact match payload consumed by the workspace client.

- [ ] **Step 4: Extend the workspace client lookup contract**

```ts
export type OrderContextLookupResult = {
  matchedCustomer: { mark: string; name: string; customerId: string } | null;
  invoiceSuggestion: { invNo: string; conflict: boolean; count: number } | null;
  phoneSuggestion: string | null;
  payerSuggestion: string | null;
};
```

Map `latestExactMatch.customerPhone` and `latestExactMatch.customerPayer` first; if no invoice context exists, fall back to inferred customer `phone` and `companyName/name`.

- [ ] **Step 5: Run tests to verify they pass**

Run:
- `npm test -- --runInBand src/lib/invoice-read-service.test.ts`
- `npm test -- --runInBand src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/invoice-read-service.ts src/lib/invoice-read-service.test.ts src/components/workspace/api/client.ts
git commit -m "Extend order context with phone and payer suggestions"
```

### Task 2: Add client-side image compression utility

**Files:**
- Create: `src/components/workspace/modules/receipts/utils/image-compression.ts`
- Test: `src/components/workspace/modules/receipts/utils/image-compression.test.ts`

- [ ] **Step 1: Write the failing utility tests**

```ts
it('keeps small images unchanged when compression is unnecessary', async () => {
  const file = makeImageFile({ width: 640, height: 480, sizeHint: 120_000, type: 'image/jpeg' });
  const result = await compressReceiptDirectImage(file);

  expect(result.file).toBe(file);
  expect(result.compressed).toBe(false);
});

it('compresses large receipt images without dropping quality below 0.30', async () => {
  const file = makeImageFile({ width: 4032, height: 3024, sizeHint: 7_000_000, type: 'image/jpeg' });
  const result = await compressReceiptDirectImage(file);

  expect(result.compressed).toBe(true);
  expect(result.qualityUsed).toBeGreaterThanOrEqual(0.30);
  expect(result.file.size).toBeLessThan(file.size);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand src/components/workspace/modules/receipts/utils/image-compression.test.ts`
Expected: FAIL because utility does not exist yet.

- [ ] **Step 3: Implement the utility**

```ts
export async function compressReceiptDirectImage(file: File): Promise<{
  file: File;
  compressed: boolean;
  qualityUsed: number | null;
}> {
  const shouldSkip = file.size <= 1_500_000 && file.type !== 'image/heic' && file.type !== 'image/heif';
  if (shouldSkip) return { file, compressed: false, qualityUsed: null };

  const bitmap = await createImageBitmap(file);
  const maxEdge = 2200;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { file, compressed: false, qualityUsed: null };
  ctx.drawImage(bitmap, 0, 0, width, height);

  let quality = 0.78;
  let blob = await canvasToBlob(canvas, 'image/jpeg', quality);
  while (blob && blob.size > 1_600_000 && quality > 0.30) {
    quality = Math.max(0.30, Number((quality - 0.08).toFixed(2)));
    blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    if (quality === 0.30) break;
  }
  if (!blob) return { file, compressed: false, qualityUsed: null };

  const compressedFile = new File([blob], replaceExtension(file.name, '.jpg'), { type: 'image/jpeg' });
  return compressedFile.size < file.size
    ? { file: compressedFile, compressed: true, qualityUsed: quality }
    : { file, compressed: false, qualityUsed: null };
}
```

- [ ] **Step 4: Run tests to verify it passes**

Run: `npm test -- --runInBand src/components/workspace/modules/receipts/utils/image-compression.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/modules/receipts/utils/image-compression.ts src/components/workspace/modules/receipts/utils/image-compression.test.ts
git commit -m "Add direct receipt upload image compression utility"
```

### Task 3: Add direct-create upload state machine and visible feedback

**Files:**
- Modify: `src/components/workspace/modules/receipts/types.ts`
- Modify: `src/components/workspace/modules/receipts/hooks/use-receipt-forms.ts`
- Modify: `src/components/workspace/modules/receipts/hooks/use-receipt-actions.ts`
- Modify: `src/components/workspace/modules/receipts/components/receipt-direct-create-dialog.tsx`
- Test: `src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx`

- [ ] **Step 1: Write the failing hook/UI tests**

```ts
it('shows a visible upload failure message and preserves direct-create form state', async () => {
  mockApiUploadCall.mockRejectedValue(new Error('Upload interrupted. Please try again on a more stable network.'));
  const { result } = renderHook(() => useReceiptActions(createDeps()));

  await act(async () => {
    await result.current.handleDirectImageSelect(makeUploadEvent(file));
  });

  expect(setError).toHaveBeenCalledWith('Upload interrupted. Please try again on a more stable network.');
  expect(result.current.directUploading).toBe(false);
  expect(result.current.directUploadStatus).toBe('failed');
});

it('renders direct-create upload error text in the dialog', () => {
  render(<ReceiptDirectCreateDialog error="Upload interrupted" uploadStatus="failed" ... />);
  expect(screen.getByText('Upload interrupted')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx`
Expected: FAIL because direct-create upload status/error is not rendered or stored yet.

- [ ] **Step 3: Add explicit direct upload status types**

```ts
export type DirectImageUploadStatus = 'idle' | 'compressing' | 'uploading' | 'success' | 'failed';
```

Track in receipt forms hook:

```ts
const [directUploadStatus, setDirectUploadStatus] = useState<DirectImageUploadStatus>('idle');
const [directUploadMessage, setDirectUploadMessage] = useState<string | null>(null);
```

Reset only when the dialog closes or a new file selection starts.

- [ ] **Step 4: Update upload handler to use compression and explicit states**

```ts
setDirectUploadStatus('compressing');
setDirectUploadMessage(tx('正在压缩图片...', 'Compressing image...'));
const prepared = await compressReceiptDirectImage(file);
setDirectUploadStatus('uploading');
setDirectUploadMessage(
  prepared.compressed
    ? tx('正在上传压缩后的图片...', 'Uploading compressed image...')
    : tx('正在上传图片...', 'Uploading image...')
);
```

On success:

```ts
setDirectUploadStatus('success');
setDirectUploadMessage(tx('图片上传成功', 'Image uploaded successfully.'));
```

On failure:

```ts
setDirectSavedImagePath(null);
setDirectUploadedImageName('');
setDirectUploadStatus('failed');
setDirectUploadMessage(mappedMessage);
setError(mappedMessage);
```

Do not clear typed receipt form fields.

- [ ] **Step 5: Render visible upload state in the dialog**

Add a small inline status block below the upload buttons:

```tsx
{uploadMessage && (
  <p className={cn(
    'text-sm',
    uploadStatus === 'failed' ? 'text-red-600' : uploadStatus === 'success' ? 'text-green-600' : 'text-muted-foreground'
  )}>
    {uploadMessage}
  </p>
)}
```

- [ ] **Step 6: Run tests to verify they pass**

Run:
- `npm test -- --runInBand src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx`
- `npm test -- --runInBand src/components/workspace/modules/receipts/components/receipt-direct-create-dialog.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/workspace/modules/receipts/types.ts src/components/workspace/modules/receipts/hooks/use-receipt-forms.ts src/components/workspace/modules/receipts/hooks/use-receipt-actions.ts src/components/workspace/modules/receipts/components/receipt-direct-create-dialog.tsx src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx
git commit -m "Add explicit direct receipt upload feedback states"
```

### Task 4: Improve upload error classification and mapping

**Files:**
- Modify: `src/app/api/upload-image/route.ts`
- Modify: `src/components/workspace/api/client.ts`
- Test: `src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx`

- [ ] **Step 1: Write the failing mapping tests**

```ts
it('maps aborted upload transport errors to a stable weak-network message', async () => {
  mockApiUploadCall.mockRejectedValue({ code: 'UPLOAD_ABORTED', message: '上传中断' });
  const { result } = renderHook(() => useReceiptActions(createDeps()));

  await act(async () => {
    await result.current.handleDirectImageSelect(makeUploadEvent(file));
  });

  expect(setError).toHaveBeenCalledWith('上传中断，请在更稳定的网络下重试');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx`
Expected: FAIL because `UPLOAD_ABORTED` is not emitted or translated yet.

- [ ] **Step 3: Classify aborted uploads in the route**

```ts
if (error instanceof Error && (error.message === 'aborted' || (error as NodeJS.ErrnoException).code === 'ECONNRESET')) {
  console.error('Upload image aborted:', {
    code: (error as NodeJS.ErrnoException).code || 'ABORTED',
    category,
    userId: currentUser.id,
  });
  return createApiErrorResponse({
    code: 'UPLOAD_ABORTED',
    status: 499,
    message: '上传中断',
  }, request);
}
```

Also keep existing 400/413/429/500 classifications unchanged.

- [ ] **Step 4: Map the new API error code on the client**

```ts
UPLOAD_ABORTED: {
  zh: '上传中断，请在更稳定的网络下重试',
  en: 'Upload interrupted. Please try again on a more stable network.',
}
```

Wire this into the same `translateApiErrorCode(...)` path used by `apiUploadCall` error handling.

- [ ] **Step 5: Run tests to verify they pass**

Run:
- `npm test -- --runInBand src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx`
- `npm test -- --runInBand src/lib/http-body.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/upload-image/route.ts src/components/workspace/api/client.ts src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx
git commit -m "Classify and map direct upload interruption errors"
```

### Task 5: Autofill `PHONE` and `PAYER` from `ORDER NO`

**Files:**
- Modify: `src/components/workspace/modules/receipts/types.ts`
- Modify: `src/components/workspace/modules/receipts/hooks/use-receipt-forms.ts`
- Modify: `src/components/workspace/modules/receipts/components/receipt-direct-create-dialog.tsx`
- Test: `src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx`

- [ ] **Step 1: Write the failing autofill tests**

```ts
it('fills phone and payer from order context using company name first', async () => {
  mockLookupOrderContextByOrderNo.mockResolvedValue({
    matchedCustomer: { mark: 'MAB-1', name: 'MAB', customerId: 'cust-1' },
    invoiceSuggestion: { invNo: 'L25MH010001', conflict: false, count: 1 },
    phoneSuggestion: '622 49 12 86',
    payerSuggestion: 'MAB SARL',
  });

  // assert directForm.tel and directForm.payer update after order input debounce
});

it('falls back payer from customer name when company name is empty', async () => {
  mockLookupOrderContextByOrderNo.mockResolvedValue({
    matchedCustomer: { mark: 'MAB-1', name: 'Mamadou Diallo', customerId: 'cust-1' },
    invoiceSuggestion: null,
    phoneSuggestion: '622 49 12 86',
    payerSuggestion: 'Mamadou Diallo',
  });

  // assert payer receives customer name fallback
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx`
Expected: FAIL because `tel` / `payer` are not populated from order context yet.

- [ ] **Step 3: Implement the direct-form autofill**

Inside the direct-create order effect:

```ts
if (context.phoneSuggestion) {
  setDirectForm((prev) => ({ ...prev, tel: context.phoneSuggestion || prev.tel }));
}
if (context.payerSuggestion) {
  setDirectForm((prev) => ({ ...prev, payer: context.payerSuggestion || prev.payer }));
}
```

Only auto-fill when suggestions exist; still allow the user to override afterward.

- [ ] **Step 4: Render these as suggestion-driven fields**

Keep the fields editable, but if populated by lookup, they should appear already filled in the dialog without requiring another user action.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --runInBand src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/workspace/modules/receipts/types.ts src/components/workspace/modules/receipts/hooks/use-receipt-forms.ts src/components/workspace/modules/receipts/components/receipt-direct-create-dialog.tsx src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx
git commit -m "Autofill receipt phone and payer from order context"
```

### Task 6: Improve mobile image picking entry points

**Files:**
- Modify: `src/components/workspace/modules/receipts/components/receipt-direct-create-dialog.tsx`
- Test: `tests/e2e/receipt-generator.spec.ts` or a direct receipt Playwright file

- [ ] **Step 1: Write the failing UI test**

```ts
it('renders separate camera and gallery upload actions on narrow/mobile layouts', () => {
  render(<ReceiptDirectCreateDialog mobileLike ... />);
  expect(screen.getByRole('button', { name: /拍照|Take Photo/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /相册|Choose from Gallery/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand src/components/workspace/modules/receipts/components/receipt-direct-create-dialog.test.tsx`
Expected: FAIL because only one generic upload button exists.

- [ ] **Step 3: Split the mobile-friendly file inputs**

```tsx
<Button type="button" variant="outline" onClick={() => cameraInputRef.current?.click()}>
  {tx('拍照', 'Take Photo')}
</Button>
<Input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onImageSelect} />

<Button type="button" variant="outline" onClick={() => galleryInputRef.current?.click()}>
  {tx('从相册选择', 'Choose from Gallery')}
</Button>
<Input ref={galleryInputRef} type="file" accept="image/*" className="hidden" onChange={onImageSelect} />
```

Keep a desktop-safe fallback button if needed, but mobile intent should be explicit.

- [ ] **Step 4: Run tests to verify it passes**

Run:
- `npm test -- --runInBand src/components/workspace/modules/receipts/components/receipt-direct-create-dialog.test.tsx`
- `npm run test:e2e:isolated`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/modules/receipts/components/receipt-direct-create-dialog.tsx src/components/workspace/modules/receipts/components/receipt-direct-create-dialog.test.tsx tests/e2e/receipt-generator.spec.ts
git commit -m "Improve direct receipt mobile image picking UX"
```

### Task 7: Full verification, docs, version, Docker, and Git sync

**Files:**
- Modify: `README.md`
- Modify: `todolist.md`
- Modify: `ENGINEERING_LOG.md`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Run the focused verification commands**

Run:
- `npm test -- --runInBand src/components/workspace/modules/receipts/utils/image-compression.test.ts`
- `npm test -- --runInBand src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx`
- `npm test -- --runInBand src/lib/invoice-read-service.test.ts`
- `npm run build`

Expected: all PASS.

- [ ] **Step 2: Run full project verification**

Run: `npm run test:ci`
Expected: PASS with unit, isolated API, and isolated E2E all green.

- [ ] **Step 3: Update version and docs**

```bash
npm version 1.0.104 --no-git-tag-version
```

Document in:
- `README.md` recent update note
- `todolist.md` current version and milestone note
- `ENGINEERING_LOG.md` technical change log

- [ ] **Step 4: Rebuild the local running service**

Run:
- `docker compose up -d --build`
- `docker exec trading-ledger-system-app-1 node -p "require('./package.json').version"`
- `curl -k -I https://localhost | head -n 1`

Expected:
- container version is `1.0.104`
- local HTTPS returns `HTTP/2 200`

- [ ] **Step 5: Commit and push**

```bash
git add README.md todolist.md ENGINEERING_LOG.md package.json package-lock.json
git commit -m "Harden direct receipt upload flow for weak mobile networks"
git push origin main
```
