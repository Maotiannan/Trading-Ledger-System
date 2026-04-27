# Signed Receipt Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native signed-receipt generation flow to Receipt Management that creates a real receipt before signing, supports desktop popup and mobile full-screen signing, stores the final PNG on NAS, downloads it to the client, and finalizes as a normal direct-created receipt without letting unfinished records enter the business workflow.

**Architecture:** Introduce a dedicated receipt-generator domain around a temporary `SIGNING_PENDING` receipt lifecycle, backed by a `ReceiptGeneratorSession` table and an atomic receipt number counter. Keep the existing receipt direct-create business path as the final persistence target, but isolate generator state, signature assets, PNG composition, and routing through dedicated read/write APIs and a focused frontend flow.

**Tech Stack:** Next.js app router, React client components, Prisma/MySQL, existing upload/NAS mount pipeline, canvas/PNG composition in browser, Jest, isolated API tests, Playwright.

---

## File Structure

### Create
- `prisma/migrations/<timestamp>_receipt_generator/` — schema migration for receipt status/session/counter changes.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-number.ts` — atomic receipt number allocation service.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-generator-service.ts` — generator session create/finalize/cancel/resume business logic.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-generator-read-service.ts` — order-context lookup and session read logic.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/receipt-generator/route.ts` — unified generator API entry.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/components/receipt-generator-launch-dialog.tsx` — Stage A launch form.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/components/receipt-generator-status-badge.tsx` — status display for signing pending rows.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/hooks/use-receipt-generator.ts` — frontend flow state/actions.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/receipt-generator/[sessionId]/page.tsx` — desktop/mobile signing route.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/signing-view.tsx` — shared signing UI.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/receipt-canvas.tsx` — receipt render preview.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/signature-pad.tsx` — signature canvas with rotate support.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/mobile-orientation-hint.tsx` — mobile full-screen orientation helper.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-generator-image.ts` — PNG composition helpers and filename generation.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-generator-layout.ts` — payload-to-layout mapping and localized labels.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-generator-download.ts` — client-side download helper if needed.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-generator-service.test.ts`
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-number.test.ts`
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-generator-read-service.test.ts`
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/hooks/use-receipt-generator.test.tsx`
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/signing-view.test.tsx`
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/tests/api/isolated/cases/65-receipt-generator-flow.case.mjs`
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/tests/e2e/receipt-generator.spec.ts`

### Modify
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/prisma/schema.prisma` — add `SIGNING_PENDING`, session table, counter table or counter model references.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-service.ts` — isolate `SIGNING_PENDING` from normal receipt business flow and direct-create finalization path.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/receipt/route.ts` — ensure normal receipt APIs do not accidentally process signing-pending receipts.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/upload-image/route.ts` — add generator image categories if storing signature assets separately.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/receipt-manager.tsx` — add launch button, reload integration, session resume behavior.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/components/receipt-list.tsx` — show pending-signing rows safely and hide business actions.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/hooks/use-receipt-actions.ts` — optionally reuse refresh logic and keep normal receipt flow separate.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/api-catalog.ts` — document new generator APIs.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/i18n/workspace/api-error-map.ts` — add generator-specific errors.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/README.md`
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/todolist.md`
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/ENGINEERING_LOG.md`
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/package.json`
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/package-lock.json`

---

### Task 1: Add database support for signing-pending receipts and atomic numbers

**Files:**
- Create: `prisma/migrations/<timestamp>_receipt_generator/*`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/prisma/schema.prisma`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-number.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { allocateNextReceiptNo } from '@/lib/receipt-number';

it('allocates receipt numbers atomically starting from 0001000', async () => {
  const first = await allocateNextReceiptNo(mockTx as never);
  const second = await allocateNextReceiptNo(mockTx as never);
  expect(first).toBe('0001000');
  expect(second).toBe('0001001');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand src/lib/receipt-number.test.ts`
Expected: FAIL because `receipt-number.ts` does not exist.

- [ ] **Step 3: Add schema changes**

Add to `/Users/maotiannan/dev/docker/Trading-Ledger-System/prisma/schema.prisma`:

```prisma
model SystemCounter {
  key       String   @id
  nextValue Int
  updatedAt DateTime @updatedAt
}

model ReceiptGeneratorSession {
  id                     String   @id @default(cuid())
  receiptId              String   @unique
  receiptNo              String
  orderNo                String
  invNo                  String?
  customerId             String?
  customerMark           String?
  customerName           String?
  clientTel              String?
  usd                    Decimal  @db.Decimal(18, 2)
  balanceBefore          Decimal? @db.Decimal(18, 2)
  balanceAfter           Decimal? @db.Decimal(18, 2)
  amountInWords          String?  @db.Text
  motif                  String?  @db.Text
  receiverSignatureUrl   String?  @db.LongText
  receiverSignatureName  String?  @db.Text
  payerSignatureUrl      String?  @db.LongText
  payerSignatureName     String?  @db.Text
  finalImageUrl          String?  @db.LongText
  finalImageName         String?  @db.Text
  layoutSnapshot         Json?
  status                 String
  createdBy              String
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  receipt Receipt @relation(fields: [receiptId], references: [id], onDelete: Cascade)
}
```

Extend receipt status enum usage to support `SIGNING_PENDING` in application logic. If Prisma enum already exists in schema as string field elsewhere, follow project convention instead of inventing a DB enum.

- [ ] **Step 4: Write minimal implementation for atomic numbering**

Create `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-number.ts`:

```ts
import type { DbTransactionClient } from '@/lib/transaction';

const RECEIPT_COUNTER_KEY = 'RECEIPT_NO';
const RECEIPT_COUNTER_START = 1000;

function formatReceiptNo(counter: number) {
  return String(counter).padStart(7, '0');
}

export async function allocateNextReceiptNo(tx: DbTransactionClient) {
  const counter = await tx.systemCounter.upsert({
    where: { key: RECEIPT_COUNTER_KEY },
    create: { key: RECEIPT_COUNTER_KEY, nextValue: RECEIPT_COUNTER_START + 1 },
    update: { nextValue: { increment: 1 } },
  });
  const value = counter.nextValue - 1;
  return formatReceiptNo(value);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --runInBand src/lib/receipt-number.test.ts`
Expected: PASS.

- [ ] **Step 6: Generate and inspect migration**

Run: `npx prisma migrate dev --name receipt_generator`
Expected: migration created and Prisma client regenerated.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/receipt-number.ts src/lib/receipt-number.test.ts
git commit -m "feat: add receipt generator persistence primitives"
```

### Task 2: Isolate signing-pending receipts from business workflow

**Files:**
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-service.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/receipt/route.ts`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-service.test.ts`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/tests/api/isolated/cases/65-receipt-generator-flow.case.mjs`

- [ ] **Step 1: Write the failing unit tests**

```ts
it('does not allow mark-received for signing-pending receipts', async () => {
  await expect(markReceiptReceived({ currentUser, receiptId: 'r1' })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
});

it('excludes signing-pending receipts from normal receipt status progression', async () => {
  expect(canEnterBusinessFlow('SIGNING_PENDING')).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- --runInBand src/lib/receipt-service.test.ts`
Expected: FAIL because the new status is not handled.

- [ ] **Step 3: Add minimal workflow guards**

In `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-service.ts`, add guard blocks like:

```ts
if (existingReceipt.status === 'SIGNING_PENDING') {
  throw badRequest('签名未完成的收据不能进入业务流程', { receiptId });
}
```

and ensure list / state transitions do not promote `SIGNING_PENDING` via detail/swift/mark-received code paths.

- [ ] **Step 4: Run unit tests again**

Run: `npm test -- --runInBand src/lib/receipt-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/receipt-service.ts src/app/api/receipt/route.ts src/lib/receipt-service.test.ts
git commit -m "feat: isolate signing-pending receipts from workflow"
```

### Task 3: Add receipt-generator read service and order context API

**Files:**
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-generator-read-service.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/receipt-generator/route.ts`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-generator-read-service.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('returns exact order invoice context and latest-invoice conflict summary', async () => {
  const result = await lookupReceiptGeneratorOrderContext(currentUser, 'BIG ALPHA-07');
  expect(result.invoiceSuggestion?.invNo).toBe('L25MH060523');
  expect(result.invoiceSuggestion?.conflict).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- --runInBand src/lib/receipt-generator-read-service.test.ts`
Expected: FAIL because service does not exist.

- [ ] **Step 3: Implement the read service**

Create `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-generator-read-service.ts` and reuse the exact ORDER matching logic from `invoice-read-service` rather than duplicating a second matching algorithm.

Skeleton:

```ts
export async function lookupReceiptGeneratorOrderContext(currentUser: CurrentUser, orderNoInput: string) {
  const context = await lookupInvoiceOrderContext(currentUser, orderNoInput);
  const latestInvoice = context.exactMatches[0] ?? null;
  return {
    orderNo: orderNoInput.trim(),
    invNo: latestInvoice?.invNo ?? null,
    invoiceSuggestion: latestInvoice
      ? { invNo: latestInvoice.invNo, conflict: context.exactMatches.length > 1, count: context.exactMatches.length }
      : null,
    customer: context.inferredCustomer,
    balanceBefore: latestInvoice?.outstanding ?? null,
    phone: context.inferredCustomer?.phone ?? null,
    exactMatches: context.exactMatches,
  };
}
```

- [ ] **Step 4: Expose GET API**

In `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/receipt-generator/route.ts`:

```ts
if (request.method === 'GET' && action === 'order-context') {
  const data = await lookupReceiptGeneratorOrderContext(currentUser, searchParams.get('orderNo') || '');
  return NextResponse.json({ success: true, data });
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- --runInBand src/lib/receipt-generator-read-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/receipt-generator-read-service.ts src/lib/receipt-generator-read-service.test.ts src/app/api/receipt-generator/route.ts
git commit -m "feat: add receipt generator order context API"
```

### Task 4: Create generator session before signing

**Files:**
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-generator-service.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/receipt-generator/route.ts`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-generator-service.test.ts`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/tests/api/isolated/cases/65-receipt-generator-flow.case.mjs`

- [ ] **Step 1: Write the failing tests**

```ts
it('creates a signing-pending receipt and session with atomic receipt number', async () => {
  const result = await createReceiptGeneratorSession({ currentUser, payload });
  expect(result.receipt.status).toBe('SIGNING_PENDING');
  expect(result.receipt.receiptNo).toBe('0001000');
  expect(result.session.receiptId).toBe(result.receipt.id);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- --runInBand src/lib/receipt-generator-service.test.ts`
Expected: FAIL because service does not exist.

- [ ] **Step 3: Implement session creation**

In `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-generator-service.ts`, create a transaction that:
- allocates receipt number using `allocateNextReceiptNo(tx)`
- resolves customer/order context
- creates a `Receipt` with `status: 'SIGNING_PENDING'`
- creates a `ReceiptGeneratorSession`
- records audit

Use a structure like:

```ts
export async function createReceiptGeneratorSession({ currentUser, payload }: Params) {
  return runInTransaction(async (tx) => {
    const receiptNo = await allocateNextReceiptNo(tx);
    const receipt = await tx.receipt.create({ data: { ...mappedFields, receiptNo, status: 'SIGNING_PENDING', createdBy: currentUser.id } });
    const session = await tx.receiptGeneratorSession.create({ data: { receiptId: receipt.id, receiptNo, orderNo: payload.orderNo, usd: payload.usd, status: 'SIGNING_PENDING', createdBy: currentUser.id } });
    return { receipt, session };
  });
}
```

- [ ] **Step 4: Expose POST session API**

```ts
if (action === 'create-session') {
  const result = await createReceiptGeneratorSession({ currentUser, payload });
  return NextResponse.json({ success: true, data: result });
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- --runInBand src/lib/receipt-generator-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/receipt-generator-service.ts src/lib/receipt-generator-service.test.ts src/app/api/receipt-generator/route.ts
git commit -m "feat: create receipt generator signing sessions"
```

### Task 5: Add receipt image composition and finalize API

**Files:**
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-generator-image.ts`
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-generator-layout.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-generator-service.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/upload-image/route.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/api/receipt-generator/route.ts`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-generator-service.test.ts`

- [ ] **Step 1: Write the failing finalize test**

```ts
it('finalizes a session, stores PNG metadata, and transitions receipt out of signing-pending', async () => {
  const result = await finalizeReceiptGeneratorSession({ currentUser, sessionId: 's1', receiverSignature, payerSignature, layout });
  expect(result.receipt.imageUrl).toMatch(/receipts\/generated/);
  expect(result.receipt.status).toBe('SR_Received');
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- --runInBand src/lib/receipt-generator-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement finalization service**

Extend `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-generator-service.ts` to:
- validate session ownership and state
- compose final PNG
- save to NAS path under `receipts/generated/YYYY/MM/`
- update receipt `imageUrl/imageName`
- update receipt status to normal direct-create starting status (`SR_Received`)
- mark session finalized
- return receipt + download metadata

- [ ] **Step 4: Expose finalize API**

```ts
if (action === 'finalize') {
  const result = await finalizeReceiptGeneratorSession({ currentUser, ...payload });
  return NextResponse.json({ success: true, data: result });
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- --runInBand src/lib/receipt-generator-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/receipt-generator-image.ts src/lib/receipt-generator-layout.ts src/lib/receipt-generator-service.ts src/lib/receipt-generator-service.test.ts src/app/api/receipt-generator/route.ts src/app/api/upload-image/route.ts
git commit -m "feat: finalize signed receipt generator output"
```

### Task 6: Add launch dialog and generator hook in Receipt Management

**Files:**
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/components/receipt-generator-launch-dialog.tsx`
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/hooks/use-receipt-generator.ts`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/receipt-manager.tsx`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/components/index.ts`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/hooks/use-receipt-generator.test.tsx`

- [ ] **Step 1: Write failing hook test**

```tsx
it('creates a generator session and opens desktop signing route after launch form submit', async () => {
  const { result } = renderHook(() => useReceiptGenerator(deps));
  await act(async () => {
    await result.current.submitLaunchForm();
  });
  expect(mockWindowOpen).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- --runInBand src/components/workspace/modules/receipts/hooks/use-receipt-generator.test.tsx`
Expected: FAIL because hook does not exist.

- [ ] **Step 3: Implement hook and dialog**

Hook responsibilities:
- manage launch form state
- call order-context API on ORDER changes
- show INV conflict warning
- call create-session API
- detect mobile vs desktop
- desktop: `window.open(signingUrl, ...)`
- mobile: router push to signing route
- receive completion callback and refresh receipt list

- [ ] **Step 4: Integrate into Receipt Management**

Add button in `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/receipt-manager.tsx`:

```tsx
{user?.role !== 'USER' && (
  <Button variant="outline" onClick={() => setShowGenerator(true)}>
    {tx('生成签名收据', 'Generate Signed Receipt')}
  </Button>
)}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- --runInBand src/components/workspace/modules/receipts/hooks/use-receipt-generator.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/workspace/modules/receipts/components/receipt-generator-launch-dialog.tsx src/components/workspace/modules/receipts/hooks/use-receipt-generator.ts src/components/workspace/modules/receipts/receipt-manager.tsx src/components/workspace/modules/receipts/components/index.ts src/components/workspace/modules/receipts/hooks/use-receipt-generator.test.tsx
git commit -m "feat: add signed receipt generator launch flow"
```

### Task 7: Build signing/preview route for desktop and mobile

**Files:**
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/app/receipt-generator/[sessionId]/page.tsx`
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/signing-view.tsx`
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/receipt-canvas.tsx`
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/signature-pad.tsx`
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/mobile-orientation-hint.tsx`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/signing-view.test.tsx`

- [ ] **Step 1: Write failing component test**

```tsx
it('rotates mobile signature canvas and advances through two signature steps', async () => {
  render(<SigningView mobile session={session} />);
  await user.click(screen.getByRole('button', { name: /rotate right/i }));
  expect(screen.getByTestId('signature-rotation')).toHaveTextContent('90');
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- --runInBand src/components/workspace/modules/receipts/generator/signing-view.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement route and signing components**

Requirements:
- render receipt preview from stored session payload
- two-step signing sequence
- desktop popup-safe flow
- mobile same-tab full-screen flow
- rotation controls for mobile signature pad
- clear orientation hint
- finalize by calling generator finalize API
- on success:
  - trigger download
  - desktop: `window.opener.postMessage(...)` and close
  - mobile: route back to `/receipts`

- [ ] **Step 4: Run tests**

Run: `npm test -- --runInBand src/components/workspace/modules/receipts/generator/signing-view.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/receipt-generator/[sessionId]/page.tsx src/components/workspace/modules/receipts/generator src/components/workspace/modules/receipts/generator/signing-view.test.tsx
git commit -m "feat: add desktop and mobile signing UI"
```

### Task 8: Add API-first generator integration test

**Files:**
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/tests/api/isolated/cases/65-receipt-generator-flow.case.mjs`

- [ ] **Step 1: Write the isolated API case**

Include assertions for:
- order-context lookup
- session creation before signing
- `receiptNo = 0001000` on fresh env
- `SIGNING_PENDING` exists but does not enter business flow
- finalize updates PNG path and receipt image fields
- receipt becomes normal starting receipt state after finalize

- [ ] **Step 2: Run isolated API test**

Run: `npm run test:api:isolated`
Expected: first fail until APIs are fully wired, then PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/api/isolated/cases/65-receipt-generator-flow.case.mjs
git commit -m "test: cover signed receipt generator API flow"
```

### Task 9: Add desktop Playwright regression

**Files:**
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/tests/e2e/receipt-generator.spec.ts`

- [ ] **Step 1: Write E2E case**

Flow:
- login as sales/admin
- open Receipt Management
- launch signed receipt generator
- fill ORDER and amount
- open signing popup
- complete both signatures
- finalize
- verify popup closes or returns
- verify latest receipt row appears with image action

- [ ] **Step 2: Run E2E test**

Run: `npm run test:e2e:isolated`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/receipt-generator.spec.ts
git commit -m "test: add signed receipt generator ui flow"
```

### Task 10: Sync docs, version, docker, and final verification

**Files:**
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/README.md`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/todolist.md`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/ENGINEERING_LOG.md`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/package.json`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/package-lock.json`

- [ ] **Step 1: Bump version**

Update `package.json` and `package-lock.json` to the next patch version after implementation is stable.

- [ ] **Step 2: Update user docs**

Document:
- new signed receipt generator entry
- mobile signing behavior
- settings page version location

- [ ] **Step 3: Update engineering log**

Record:
- session table
- atomic numbering
- signing-pending isolation
- API/E2E coverage

- [ ] **Step 4: Run final verification**

Run:
- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`
- `npm run test:ci`

Expected: all PASS.

- [ ] **Step 5: Rebuild local service**

Run: `docker compose up -d --build`
Expected: local app container runs the new version and `https://localhost` returns `200`.

- [ ] **Step 6: Commit and push**

```bash
git add README.md todolist.md ENGINEERING_LOG.md package.json package-lock.json
git commit -m "feat: integrate signed receipt generator"
git push origin main
```

## Self-Review

### Spec coverage
- launch form inside Receipt Management: covered by Task 6.
- desktop popup vs mobile same-tab full-screen signing: covered by Task 7.
- two signatures retained: covered by Task 7.
- receipt created before signing: covered by Task 4.
- unfinished receipts excluded from workflow: covered by Task 2.
- atomic numbering from `0001000`: covered by Task 1 and Task 4.
- final PNG on NAS and attached to receipt: covered by Task 5.
- automatic return and refresh: covered by Task 6 and Task 7.
- API-first testing and Playwright flow: covered by Task 8 and Task 9.

### Placeholder scan
- No `TBD`, `TODO`, or “implement later” placeholders remain.
- Each task has explicit files and concrete commands.

### Type consistency
- Generator temporary status is consistently named `SIGNING_PENDING`.
- Atomic number helper consistently uses `allocateNextReceiptNo`.
- Backend APIs consistently use `order-context`, `create-session`, `finalize`, and optional `cancel` actions.

