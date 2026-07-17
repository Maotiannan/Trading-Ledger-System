# Global Matching And Receipt/Detail Follow-Ups Implementation Plan

> **Plan status:** `ARCHIVED_COMPLETED` as of 2026-07-17. The implementation is on `main`; unchecked boxes below are retained as the original execution checklist and are not active backlog. See [the status index](./README.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify all `ORDER_NAME`-based matching behind one shared spacing-insensitive kernel, upgrade invoice/receipt flows to use it, support one customer master profile with multiple `ORDER_NAME` aliases, and then land the dependent receipt/detail/mobile/export enhancements.

**Architecture:** Introduce a customer master + alias child-table model and route all order/customer resolution through a new shared matching module. Implement the work in three batches: Batch A for matching/data model/core invoice-receipt behavior, Batch B for receipt list/mobile UI, and Batch C for detail export and signed receipt payment mode. The detail OCR confirm hotfix in `v1.0.113` is treated as an already-completed prerequisite, not a task in this plan.

**Tech Stack:** Next.js App Router, React, TypeScript, Prisma/MySQL, Jest, isolated API test harness, Playwright isolated UI tests, Docker Compose.

---

## File Structure

### Existing files to modify
- `prisma/schema.prisma`
- `src/lib/customer-matching.ts`
- `src/lib/customer-service.ts`
- `src/lib/customer-read-service.ts`
- `src/lib/invoice-read-service.ts`
- `src/lib/invoice-write.ts`
- `src/lib/invoice-service.ts`
- `src/lib/receipt-generator-read-service.ts`
- `src/lib/excel-ml-service.ts`
- `src/lib/matching.ts`
- `src/app/api/customer/route.ts`
- `src/app/api/invoice/route.ts`
- `src/app/api/receipt/route.ts`
- `src/app/api/detail/route.ts`
- `src/components/workspace/modules/customers/components/customer-form-dialog.tsx`
- `src/components/workspace/modules/customers/customer-manager.tsx`
- `src/components/workspace/modules/customers/types.ts`
- `src/components/workspace/modules/invoices/components/edit-order-dialog.tsx`
- `src/components/workspace/modules/invoices/hooks/use-invoice-order-forms.ts`
- `src/components/workspace/modules/invoices/hooks/use-invoice-import.tsx`
- `src/components/workspace/modules/receipts/components/receipt-upload-dialog.tsx`
- `src/components/workspace/modules/receipts/hooks/use-receipt-actions.ts`
- `src/components/workspace/modules/receipts/receipt-manager.tsx`
- `src/components/workspace/modules/details/components/detail-list.tsx`
- `src/components/workspace/modules/details/detail-manager.tsx`
- `src/components/workspace/modules/details/components/detail-direct-create-dialog.tsx`
- `src/components/workspace/modules/receipts/components/receipt-generator-launch-dialog.tsx`
- `src/components/workspace/modules/receipts/generator/receipt-canvas.tsx`
- `src/lib/api-catalog.ts`
- `README.md`
- `todolist.md`
- `ENGINEERING_LOG.md`

### New files to create
- `prisma/migrations/<timestamp>_customer_order_name_aliases/migration.sql`
- `src/lib/order-name-kernel.ts`
- `src/lib/order-name-kernel.test.ts`
- `src/lib/customer-order-name-service.ts`
- `src/lib/customer-order-name-service.test.ts`
- `src/lib/detail-export-image.ts`
- `src/lib/detail-export-image.test.ts`
- `tests/api/isolated/cases/22-global-order-name-matching.case.mjs`
- `tests/e2e/receipt-mobile-dialog.spec.ts`

### Boundaries
- `order-name-kernel.ts` becomes the single place for whitespace-insensitive order-name normalization and matching primitives.
- `customer-order-name-service.ts` owns alias lifecycle rules and migration-safe read/write helpers.
- Existing invoice/receipt/detail/Excel ML services consume the kernel; they do not each define their own normalization rules.
- `detail-export-image.ts` owns the handwritten-style `Export Pic` rendering, keeping image generation out of React components.

## Task 1: Add customer alias data model and migration

**Files:**
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/prisma/schema.prisma`
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/prisma/migrations/<timestamp>_customer_order_name_aliases/migration.sql`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/customer-order-name-service.test.ts`

- [ ] **Step 1: Write the failing alias-service tests**

```ts
import { normalizeOrderNameLoose } from '@/lib/order-name-kernel';
import { listCustomerOrderNamesForCustomer } from '@/lib/customer-order-name-service';

test('normalizeOrderNameLoose removes all whitespace before matching', () => {
  expect(normalizeOrderNameLoose('S U P E R DT 2')).toBe('superdt2');
});

test('customer alias service returns all ORDER_NAME aliases for one customer', async () => {
  const rows = await listCustomerOrderNamesForCustomer('customer-1');
  expect(rows.map((row) => row.value)).toEqual(['MAB-1', 'MARY']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand src/lib/customer-order-name-service.test.ts`
Expected: FAIL because alias table/helpers do not exist yet.

- [ ] **Step 3: Add Prisma models and migration**

```prisma
model Customer {
  id          String              @id @default(cuid())
  mark        String
  orderName   String              @map("order_name")
  orderNames  CustomerOrderName[]
  // existing fields unchanged
}

model CustomerOrderName {
  id             String   @id @default(cuid())
  customerId     String
  value          String
  normalizedValue String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  customer Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)

  @@index([customerId])
  @@index([normalizedValue])
  @@unique([customerId, normalizedValue])
}
```

```sql
INSERT INTO CustomerOrderName (id, customerId, value, normalizedValue, createdAt, updatedAt)
SELECT cuid(), id, order_name, LOWER(REPLACE(order_name, ' ', '')), NOW(), NOW()
FROM Customer
WHERE TRIM(order_name) <> '';
```

- [ ] **Step 4: Add minimal alias service helpers**

```ts
export function normalizeOrderNameLoose(value: string | null | undefined): string {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

export async function listCustomerOrderNamesForCustomer(customerId: string) {
  return db.customerOrderName.findMany({ where: { customerId }, orderBy: { createdAt: 'asc' } });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --runInBand src/lib/customer-order-name-service.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/customer-order-name-service.ts src/lib/customer-order-name-service.test.ts src/lib/order-name-kernel.ts src/lib/order-name-kernel.test.ts
git commit -m "feat: add customer order-name alias model"
```

## Task 2: Build shared global order-name matching kernel

**Files:**
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/order-name-kernel.ts`
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/order-name-kernel.test.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/customer-matching.ts`

- [ ] **Step 1: Write failing kernel tests covering spacing-insensitive matching**

```ts
import { extractOrderStem, normalizeOrderNameLoose, matchesOrderStemToAlias } from '@/lib/order-name-kernel';

test('extractOrderStem keeps canonical prefix before final dash', () => {
  expect(extractOrderStem('SUPER DT 2-01')).toBe('SUPER DT 2');
  expect(extractOrderStem('S U P E R D T 2 -01')).toBe('S U P E R D T 2');
});

test('matchesOrderStemToAlias ignores whitespace', () => {
  expect(matchesOrderStemToAlias('SUPERDT2', 'SUPER DT 2')).toBe(true);
  expect(matchesOrderStemToAlias('MAB1', 'MAB-1')).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand src/lib/order-name-kernel.test.ts`
Expected: FAIL because the kernel does not exist yet.

- [ ] **Step 3: Implement the kernel**

```ts
export function normalizeOrderNameLoose(value: string | null | undefined): string {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

export function extractOrderStem(orderNo: string | null | undefined): string | null {
  const normalized = String(orderNo || '').trim();
  const lastDash = normalized.lastIndexOf('-');
  if (lastDash <= 0) return null;
  const left = normalized.slice(0, lastDash).trim();
  return left || null;
}

export function matchesOrderStemToAlias(orderStem: string | null | undefined, alias: string | null | undefined): boolean {
  const left = normalizeOrderNameLoose(orderStem);
  const right = normalizeOrderNameLoose(alias);
  return Boolean(left) && left === right;
}
```

- [ ] **Step 4: Refactor customer matching to call the kernel**

```ts
import { extractOrderStem, normalizeOrderNameLoose } from '@/lib/order-name-kernel';

export function extractOrderNameFromOrderNo(value: string | null | undefined): string | null {
  return extractOrderStem(value);
}
```

- [ ] **Step 5: Run focused tests**

Run: `npm test -- --runInBand src/lib/order-name-kernel.test.ts src/lib/matching.test.ts src/lib/customer-matching.ts`
Expected: kernel tests PASS and no regressions in existing matching tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/order-name-kernel.ts src/lib/order-name-kernel.test.ts src/lib/customer-matching.ts
git commit -m "feat: add shared order-name matching kernel"
```

## Task 3: Route customer creation, editing, and import through the alias model

**Files:**
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/customer-service.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/customer-read-service.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/customer/route.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/customers/components/customer-form-dialog.tsx`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/customers/customer-manager.tsx`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/customers/types.ts`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/customer-service.test.ts`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/tests/api/isolated/cases/10-customer-import-and-scope.case.mjs`

- [ ] **Step 1: Write failing tests for one-row create/import plus multi-alias edit**

```ts
test('customer create stores one alias row for the entered ORDER_NAME', async () => {
  const result = await createCustomer({ orderName: 'MAB-1', mark: 'SDT 2', ... });
  expect(result.customer.orderNames.map((row) => row.value)).toEqual(['MAB-1']);
});

test('customer edit can append MARY alias without changing original MAB-1 alias', async () => {
  const updated = await updateCustomer(customerId, { orderNames: ['MAB-1', 'MARY'] });
  expect(updated.orderNames.map((row) => row.value)).toEqual(['MAB-1', 'MARY']);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --runInBand src/lib/customer-service.test.ts`
Expected: FAIL because alias writes/reads are not implemented.

- [ ] **Step 3: Implement alias-aware customer writes and reads**

```ts
await tx.customerOrderName.deleteMany({ where: { customerId } });
await tx.customerOrderName.createMany({
  data: orderNames.map((value) => ({
    customerId,
    value,
    normalizedValue: normalizeOrderNameLoose(value),
  })),
});
```

```ts
const customers = await db.customer.findMany({
  include: { orderNames: { orderBy: { createdAt: 'asc' } } },
});
```

- [ ] **Step 4: Update form types and edit UI**

```ts
type CustomerFormState = {
  orderName: string;
  additionalOrderNames: string[];
};
```

```tsx
{isEditing && additionalOrderNames.map((value, index) => (
  <Input key={index} value={value} onChange={(e) => updateAlias(index, e.target.value)} />
))}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- --runInBand src/lib/customer-service.test.ts src/components/workspace/modules/customers/components/customer-form-dialog.test.tsx`
Expected: PASS

- [ ] **Step 6: Extend isolated API case for multi-alias customer semantics**

```js
const updated = await t.request('PUT', '/api/customer', {
  json: { action: 'update', id: customerId, orderNames: ['MAB-1', 'MARY'] },
  expectedStatus: 200,
});
```

- [ ] **Step 7: Re-run isolated case**

Run: `npm run test:api:isolated -- --case 10-customer-import-and-scope`
Expected: PASS with alias assertions.

- [ ] **Step 8: Commit**

```bash
git add src/lib/customer-service.ts src/lib/customer-read-service.ts src/app/api/customer/route.ts src/components/workspace/modules/customers/components/customer-form-dialog.tsx src/components/workspace/modules/customers/customer-manager.tsx src/components/workspace/modules/customers/types.ts src/lib/customer-service.test.ts tests/api/isolated/cases/10-customer-import-and-scope.case.mjs
git commit -m "feat: support multiple order-name aliases per customer"
```

## Task 4: Upgrade invoice flows and bulk import to shared matching

**Files:**
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/invoice-write.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/invoice-service.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/invoice-read-service.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/invoice/route.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/invoices/hooks/use-invoice-import.tsx`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/invoices/components/edit-order-dialog.tsx`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/invoices/hooks/use-invoice-order-forms.ts`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/invoice-service.test.ts`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/invoice-read-service.test.ts`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/tests/api/isolated/cases/20-invoice-ledger-flow.case.mjs`
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/tests/api/isolated/cases/22-global-order-name-matching.case.mjs`

- [ ] **Step 1: Write failing tests for spacing-insensitive bulk import and INV reassignment**

```ts
test('invoice import resolves SUPERDT2-09 through shared alias kernel', async () => {
  const result = await importInvoiceRows([{ invNo: 'INV-1', orderNo: 'SUPERDT2-09', customerMark: 'mismatch', amount: '100' }]);
  expect(result.imported[0].customerMark).toBe('SDT 2');
});

test('updateOrder can move an order to another invoice by invNo', async () => {
  const moved = await updateOrder({ orderId, invNo: 'L25MH099999' });
  expect(moved.invoice.invNo).toBe('L25MH099999');
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `npm test -- --runInBand src/lib/invoice-service.test.ts src/lib/invoice-read-service.test.ts`
Expected: FAIL

- [ ] **Step 3: Refactor invoice create/import/rematch/edit to shared kernel**

```ts
const resolution = await resolveCustomerByMarkOrOrderStem({
  customerMark,
  customerOrderNo: orderNo,
  ownerIds,
});
```

```ts
if (payload.invNo && payload.invNo !== existing.invoice.invNo) {
  const targetInvoice = await tx.invoice.findFirst({ where: { invNo: payload.invNo, createdBy: existing.invoice.createdBy } });
  if (!targetInvoice) throw badRequest('目标 INV NO 不存在');
  await tx.order.update({ where: { id: orderId }, data: { invoiceId: targetInvoice.id } });
}
```

- [ ] **Step 4: Update edit-order dialog to expose INV NO**

```tsx
<Input value={form.invNo} onChange={(e) => setForm((prev) => ({ ...prev, invNo: e.target.value }))} />
```

- [ ] **Step 5: Add isolated API coverage**

```js
t.step('spacing-insensitive alias matching works for SUPERDT2-09 and SUPER DT 2-09');
```

- [ ] **Step 6: Run verification**

Run: `npm run test:api:isolated -- --case 20-invoice-ledger-flow && npm run test:api:isolated -- --case 22-global-order-name-matching`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/invoice-write.ts src/lib/invoice-service.ts src/lib/invoice-read-service.ts src/app/api/invoice/route.ts src/components/workspace/modules/invoices/components/edit-order-dialog.tsx src/components/workspace/modules/invoices/hooks/use-invoice-order-forms.ts src/components/workspace/modules/invoices/hooks/use-invoice-import.tsx src/lib/invoice-service.test.ts src/lib/invoice-read-service.test.ts tests/api/isolated/cases/20-invoice-ledger-flow.case.mjs tests/api/isolated/cases/22-global-order-name-matching.case.mjs
git commit -m "feat: unify invoice flows on global order-name matching"
```

## Task 5: Make receipt OCR prefer database truth and add receipt balance column

**Files:**
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/receipt/route.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/invoice-read-service.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/hooks/use-receipt-actions.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/components/receipt-upload-dialog.tsx`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/components/receipt-list.tsx`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/receipt-manager.tsx`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/tests/api/isolated/cases/60-receipt-detail-swift-lifecycle.case.mjs`

- [ ] **Step 1: Write failing tests for OCR precedence and balance display data**

```ts
test('receipt OCR uses DB invNo/mark/payer/phone when OCR orderNo matches an existing order', async () => {
  const result = await recognizeReceipt(...);
  expect(result.ocrResult.invNo).toBe('L25MH071089C');
  expect(result.ocrResult.customerMark).toBe('MAB-1');
});
```

```ts
test('receipt list row exposes post-receipt balance or dash', () => {
  expect(mapReceiptRow({ orderBalanceAfterReceipt: 80 }).balanceDisplay).toBe('$80.00');
  expect(mapReceiptRow({ orderBalanceAfterReceipt: null }).balanceDisplay).toBe('-');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- --runInBand src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement receipt OCR precedence**

```ts
if (matchedOrderContext) {
  normalizedOcrResult = {
    ...ocrResult,
    invNo: matchedOrderContext.invNo,
    customerMark: matchedOrderContext.customer.mark,
    payer: matchedOrderContext.customer.companyName || matchedOrderContext.customer.name,
    tel: matchedOrderContext.customer.phone,
  };
}
```

- [ ] **Step 4: Add balance field to receipt rows**

```ts
const balanceAfterReceipt = order ? Number(order.orderBalance) - Number(receipt.usd) : null;
```

- [ ] **Step 5: Verify**

Run: `npm test -- --runInBand src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx src/components/workspace/modules/receipts/receipt-manager.test.tsx`
Expected: PASS

- [ ] **Step 6: Re-run isolated lifecycle case**

Run: `npm run test:api:isolated -- --case 60-receipt-detail-swift-lifecycle`
Expected: PASS with DB-truth OCR assertions.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/receipt/route.ts src/lib/invoice-read-service.ts src/components/workspace/modules/receipts/hooks/use-receipt-actions.ts src/components/workspace/modules/receipts/components/receipt-upload-dialog.tsx src/components/workspace/modules/receipts/components/receipt-list.tsx src/components/workspace/modules/receipts/receipt-manager.tsx src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx tests/api/isolated/cases/60-receipt-detail-swift-lifecycle.case.mjs
git commit -m "feat: prefer database truth in receipt OCR backfill"
```

## Task 6: Fix mobile receipt upload dialog and action layout

**Files:**
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/receipt-manager.tsx`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/components/receipt-upload-dialog.tsx`
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/tests/e2e/receipt-mobile-dialog.spec.ts`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/components/receipt-upload-dialog.test.tsx`

- [ ] **Step 1: Write failing UI tests for narrow-screen button visibility and top button order**

```tsx
expect(screen.getAllByRole('button', { name: /upload receipt|create directly|generate signed receipt/i }).map((button) => button.textContent)).toEqual([
  'Upload Receipt',
  'Create Directly',
  'Generate Signed Receipt',
]);
```

```ts
await expect(page.getByRole('button', { name: 'Confirm Create' })).toBeVisible();
```

- [ ] **Step 2: Run failing tests**

Run: `npm test -- --runInBand src/components/workspace/modules/receipts/components/receipt-upload-dialog.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement sticky footer + mobile-safe dialog layout**

```tsx
<DialogContent className="max-h-[90vh] overflow-hidden">
  <div className="flex max-h-[calc(90vh-5rem)] flex-col">
    <div className="flex-1 overflow-y-auto">...</div>
    <DialogFooter className="sticky bottom-0 bg-background">...</DialogFooter>
  </div>
</DialogContent>
```

- [ ] **Step 4: Reorder receipt page top actions**

```tsx
const actionButtons = [uploadReceiptButton, createDirectlyButton, generateSignedReceiptButton];
```

- [ ] **Step 5: Verify tests**

Run: `npm test -- --runInBand src/components/workspace/modules/receipts/components/receipt-upload-dialog.test.tsx && npm run test:e2e:isolated -- --grep "receipt mobile dialog"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/workspace/modules/receipts/receipt-manager.tsx src/components/workspace/modules/receipts/components/receipt-upload-dialog.tsx src/components/workspace/modules/receipts/components/receipt-upload-dialog.test.tsx tests/e2e/receipt-mobile-dialog.spec.ts
git commit -m "fix: harden receipt mobile upload dialog"
```

## Task 7: Add direct detail Export Pic rendering

**Files:**
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/detail-export-image.ts`
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/detail-export-image.test.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/detail/route.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/details/components/detail-list.tsx`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/details/detail-manager.tsx`

- [ ] **Step 1: Write failing image-generation tests**

```ts
test('detail export image renders numbered lines and total footer', async () => {
  const png = await buildDetailExportImage({
    date: '2026-04-27',
    totalAmount: 51386,
    items: [
      { mark: 'Big Alpha', amount: 5500, orderNo: 'Big Alpha-07' },
    ],
  });
  expect(png.byteLength).toBeGreaterThan(1000);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- --runInBand src/lib/detail-export-image.test.ts`
Expected: FAIL because the renderer does not exist.

- [ ] **Step 3: Implement renderer and export endpoint/action**

```ts
ctx.fillText(`Payment details for $${total} ${title} ${date}`, 24, 40);
items.forEach((item, index) => {
  ctx.fillText(`${index + 1}`, 24, lineY);
  ctx.fillText(item.mark, 70, lineY);
  ctx.fillText(`$ ${item.amount}`, 260, lineY);
  ctx.fillText(`Payment for ${item.orderNo}`, 430, lineY);
});
ctx.fillText(`Total amount transferred $${total}#`, 80, footerY);
```

- [ ] **Step 4: Add UI button for direct-created rows only**

```tsx
{row.source === 'DIRECT' && <Button onClick={() => onExportPic(row.id)}>Export Pic</Button>}
```

- [ ] **Step 5: Verify tests**

Run: `npm test -- --runInBand src/lib/detail-export-image.test.ts src/components/workspace/modules/details/detail-manager.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/detail-export-image.ts src/lib/detail-export-image.test.ts src/app/api/detail/route.ts src/components/workspace/modules/details/components/detail-list.tsx src/components/workspace/modules/details/detail-manager.tsx
git commit -m "feat: export direct payment detail as image"
```

## Task 8: Add signed receipt payment mode

**Files:**
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-generator-layout.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-generator-service.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/receipt-generator/route.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/components/receipt-generator-launch-dialog.tsx`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/receipt-canvas.tsx`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-generator-layout.test.ts`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/receipt-generator/route.test.ts`

- [ ] **Step 1: Write failing tests for payment mode default and render placement**

```ts
test('receipt generator layout defaults payment mode to Cash', () => {
  const layout = buildReceiptGeneratorLayout({ ...base, paymentMode: undefined });
  expect(layout.paymentMode).toBe('Cash');
});
```

```ts
test('create-session accepts Transfer and stores it in session snapshot', async () => {
  const result = await createReceiptGeneratorSession({ orderNo: 'MAB-1-10', usdAmount: 1, paymentMode: 'Transfer' });
  expect(result.data.layout.paymentMode).toBe('Transfer');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- --runInBand src/lib/receipt-generator-layout.test.ts src/app/api/receipt-generator/route.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement dropdown + stored value + render**

```tsx
<Select value={paymentMode} onValueChange={setPaymentMode}>
  <SelectItem value="Cash">Cash</SelectItem>
  <SelectItem value="Transfer">Transfer</SelectItem>
</Select>
```

```ts
const paymentMode = input.paymentMode === 'Transfer' ? 'Transfer' : 'Cash';
```

```ts
ctx.textAlign = 'right';
ctx.fillText(`Mode de paiement : ${paymentMode}`, rightX, resteLineY);
```

- [ ] **Step 4: Verify tests**

Run: `npm test -- --runInBand src/lib/receipt-generator-layout.test.ts src/app/api/receipt-generator/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/receipt-generator-layout.ts src/lib/receipt-generator-service.ts src/app/api/receipt-generator/route.ts src/components/workspace/modules/receipts/components/receipt-generator-launch-dialog.tsx src/components/workspace/modules/receipts/generator/receipt-canvas.tsx src/lib/receipt-generator-layout.test.ts src/app/api/receipt-generator/route.test.ts
git commit -m "feat: add signed receipt payment mode"
```

## Task 9: Full regression, docs, version, and local runtime sync

**Files:**
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/package.json`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/README.md`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/todolist.md`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/ENGINEERING_LOG.md`

- [ ] **Step 1: Update version and release notes**

```json
{
  "version": "1.0.114"
}
```

- [ ] **Step 2: Run full verification suite**

Run:
```bash
npm run build
npm run test:ci
```
Expected: full pass

- [ ] **Step 3: Rebuild local Docker runtime**

Run:
```bash
docker rm -f trading-ledger-system-app-1 || true
docker compose up -d --build
```
Expected: local app container running new version

- [ ] **Step 4: Verify runtime**

Run:
```bash
docker compose exec -T app node -p "require('./package.json').version"
curl -k -I https://localhost
```
Expected:
- version matches release
- `HTTP/2 200`

- [ ] **Step 5: Commit**

```bash
git add package.json README.md todolist.md ENGINEERING_LOG.md
git commit -m "chore: release follow-up matching and receipt/detail updates"
```

- [ ] **Step 6: Push**

```bash
git push origin main
```

## Self-Review
- Spec coverage:
  - Requirement 1 covered by Task 4.
  - Requirement 2 covered by Task 5.
  - Requirement 3 covered by Task 5.
  - Requirement 4 covered by Task 7.
  - Requirement 5 covered by Task 8.
  - Requirement 6 covered by Tasks 1 and 3.
  - Requirement 7 covered by Task 6.
  - Requirement 8 covered by Task 4.
  - Requirement 9 covered by Tasks 1, 2, 3, 4, and 5.
- Placeholder scan complete: no `TODO/TBD` placeholders remain.
- Type consistency check complete: alias kernel names, payload field names, and route action names align with existing module naming.
