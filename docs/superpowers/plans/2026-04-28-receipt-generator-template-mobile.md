# Receipt Generator Template And Mobile Signing Implementation Plan

> **Plan status:** `ARCHIVED_COMPLETED` as of 2026-07-17. The implementation is on `main`; unchecked boxes below are retained as the original execution checklist and are not active backlog. See [the status index](./README.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the generated signed receipt visually match the approved `receipt_layout_editor.html` template, and replace the current inline mobile signature pads with a focused full-screen per-signature mobile flow while preserving existing backend generator APIs and receipt persistence behavior.

**Architecture:** Keep the current signed-receipt generator session model and finalize API unchanged, but replace the receipt rendering layer with a frozen template-definition-driven renderer derived from the provided HTML. On mobile, keep the same route but introduce a dedicated full-screen overlay state per signature target, with portrait-safe guidance and best-effort fullscreen/landscape escalation instead of inline signature cards.

**Tech Stack:** Next.js app router, React client components, Canvas 2D export, existing `/api/receipt-generator` flow, Jest, isolated API tests, Playwright.

---

## File Structure

### Create
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/template-assets.ts` — frozen embedded assets extracted from `receipt_layout_editor.html`.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/template-geometry.ts` — source-of-truth positions, sizes, fonts, and signature box coordinates.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/mobile-signature-overlay.tsx` — full-screen white signing surface for one signature target.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/template-geometry.test.ts` — template geometry/unit regression.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/mobile-signature-overlay.test.tsx` — mobile overlay behavior tests.

### Modify
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/receipt-canvas.tsx` — swap simplified table renderer for frozen template renderer.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/signature-pad.tsx` — simplify to core pointer drawing surface; remove rotate controls.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/signing-view.tsx` — desktop layout preserved, mobile gets click-to-fullscreen signature flow.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/mobile-orientation-hint.tsx` — repurpose into portrait guidance plus fullscreen/landscape affordance.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/tests/e2e/receipt-generator.spec.ts` — add mobile flow coverage while preserving desktop popup assertions.
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/README.md`
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/todolist.md`
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/ENGINEERING_LOG.md`
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/package.json`
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/package-lock.json`

---

### Task 1: Freeze the approved receipt template into project-managed assets and geometry

**Files:**
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/template-assets.ts`
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/template-geometry.ts`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/template-geometry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import {
  RECEIPT_TEMPLATE_CANVAS,
  RECEIPT_TEMPLATE_SIGNATURE_BOXES,
  RECEIPT_TEMPLATE_TEXT_ROWS,
} from '@/components/workspace/modules/receipts/generator/template-geometry';

describe('receipt generator template geometry', () => {
  it('defines the approved fixed canvas and both signature boxes', () => {
    expect(RECEIPT_TEMPLATE_CANVAS).toEqual({ width: 1200, height: 1650 });
    expect(RECEIPT_TEMPLATE_SIGNATURE_BOXES.receiver.width).toBeGreaterThan(300);
    expect(RECEIPT_TEMPLATE_SIGNATURE_BOXES.payer.width).toBeGreaterThan(300);
    expect(RECEIPT_TEMPLATE_TEXT_ROWS.length).toBeGreaterThan(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand src/components/workspace/modules/receipts/generator/template-geometry.test.ts`
Expected: FAIL because `template-geometry.ts` does not exist.

- [ ] **Step 3: Add template assets module**

Create `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/template-assets.ts`:

```ts
export const RECEIPT_TEMPLATE_ASSETS = {
  leftLogoDataUrl: 'data:image/png;base64,...',
};

export type ReceiptTemplateAssets = typeof RECEIPT_TEMPLATE_ASSETS;
```

Implementation rule:
- extract the real embedded base64 image from `receipt_layout_editor.html`
- keep only the assets used in the final receipt shell
- do not include any debug-panel content

- [ ] **Step 4: Add template geometry module**

Create `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/template-geometry.ts`:

```ts
export const RECEIPT_TEMPLATE_CANVAS = { width: 1200, height: 1650 } as const;

export const RECEIPT_TEMPLATE_SIGNATURE_BOXES = {
  receiver: { x: 80, y: 1200, width: 420, height: 160 },
  payer: { x: 660, y: 1200, width: 420, height: 160 },
} as const;

export const RECEIPT_TEMPLATE_TEXT_ROWS = [
  { key: 'orderNo', label: 'Order No.', x: 60, y: 190 },
  { key: 'invNo', label: 'Invoice No.', x: 60, y: 232 },
  { key: 'clientName', label: 'Client', x: 60, y: 274 },
  { key: 'clientTel', label: 'Tel', x: 60, y: 316 },
  { key: 'usdAmount', label: 'Amount (USD)', x: 60, y: 358 },
  { key: 'amountInWords', label: 'Amount in words', x: 60, y: 400 },
  { key: 'motif', label: 'Motif', x: 60, y: 442 },
  { key: 'balanceBefore', label: 'Balance before', x: 60, y: 484 },
  { key: 'balanceAfter', label: 'Balance after', x: 60, y: 526 },
  { key: 'resteAPayer', label: 'Reste a payer', x: 60, y: 568 },
  { key: 'receivedBy', label: 'Received by', x: 60, y: 610 },
] as const;
```

Implementation rule:
- lock the actual coordinates to the approved HTML template
- if any values differ from the current simplified renderer, the HTML wins

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --runInBand src/components/workspace/modules/receipts/generator/template-geometry.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/workspace/modules/receipts/generator/template-assets.ts \
  src/components/workspace/modules/receipts/generator/template-geometry.ts \
  src/components/workspace/modules/receipts/generator/template-geometry.test.ts
git commit -m "feat: freeze signed receipt template geometry"
```

### Task 2: Replace the simplified receipt export renderer with the approved template

**Files:**
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/receipt-canvas.tsx`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-generator-layout.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/lib/receipt-generator-layout.test.ts`:

```ts
it('keeps client and motif values compatible with the frozen approved template', () => {
  const layout = buildReceiptGeneratorLayout({
    receiptNo: '0001000',
    orderNo: 'Big Alpha-07',
    invNo: 'L25MH060523',
    customerMark: 'Big Alpha',
    customerName: 'Alpha Oumar Diallo',
    clientTel: '628 38 63 63',
    usdAmount: 2500,
    balanceBefore: 34660,
  });

  expect(layout.clientName).toBe('Alpha Oumar Diallo "Big Alpha"');
  expect(layout.motif).toBe('Payment for L25MH060523 Big Alpha-07');
  expect(layout.resteAPayer).toBe('$34660.00 - $2500.00 = $32160.00');
});
```

- [ ] **Step 2: Run test to verify it still passes**

Run: `npm test -- --runInBand src/lib/receipt-generator-layout.test.ts`
Expected: PASS. This confirms we can refactor the renderer without changing payload semantics.

- [ ] **Step 3: Replace the draw function with geometry-driven rendering**

In `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/receipt-canvas.tsx`, replace the hand-authored row drawing with template-driven rendering:

```ts
import {
  RECEIPT_TEMPLATE_CANVAS,
  RECEIPT_TEMPLATE_SIGNATURE_BOXES,
  RECEIPT_TEMPLATE_TEXT_ROWS,
} from './template-geometry';
import { RECEIPT_TEMPLATE_ASSETS } from './template-assets';

async function drawReceiptCanvas(
  canvas: HTMLCanvasElement,
  layout: ReceiptGeneratorLayoutData,
  receiverSignature: string | null,
  payerSignature: string | null,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  canvas.width = RECEIPT_TEMPLATE_CANVAS.width;
  canvas.height = RECEIPT_TEMPLATE_CANVAS.height;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const leftLogo = await loadImage(RECEIPT_TEMPLATE_ASSETS.leftLogoDataUrl);
  if (leftLogo) {
    ctx.drawImage(leftLogo, 60, 48, 220, 120);
  }

  ctx.font = '28px Arial';
  ctx.fillStyle = '#111827';
  ctx.fillText('RECU / RECEIPT', 430, 70);
  ctx.font = '18px Arial';
  ctx.fillText(`No.: ${layout.receiptNo}`, 60, 120);
  ctx.fillText(`Date: ${layout.dateText}`, 920, 120);

  for (const row of RECEIPT_TEMPLATE_TEXT_ROWS) {
    ctx.font = 'bold 18px Arial';
    ctx.fillText(row.label, row.x, row.y);
    ctx.font = '18px Arial';
    ctx.fillText(resolveTemplateValue(layout, row.key), 310, row.y);
  }
}
```

Also change the rendered canvas element to use the template dimensions:

```tsx
<canvas
  ref={canvasRef}
  width={RECEIPT_TEMPLATE_CANVAS.width}
  height={RECEIPT_TEMPLATE_CANVAS.height}
  className="h-auto w-full rounded-lg bg-white"
/>
```

- [ ] **Step 4: Run targeted tests**

Run: `npm test -- --runInBand src/lib/receipt-generator-layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/modules/receipts/generator/receipt-canvas.tsx \
  src/lib/receipt-generator-layout.test.ts
git commit -m "feat: render signed receipts with approved template"
```

### Task 3: Replace mobile inline signing with focused full-screen per-signature mode

**Files:**
- Create: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/mobile-signature-overlay.tsx`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/signature-pad.tsx`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/signing-view.tsx`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/mobile-signature-overlay.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/mobile-signature-overlay.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileSignatureOverlay } from '@/components/workspace/modules/receipts/generator/mobile-signature-overlay';

describe('MobileSignatureOverlay', () => {
  it('shows fullscreen signing mode with english watermark and fullscreen action', async () => {
    const onClose = jest.fn();
    render(
      <MobileSignatureOverlay
        open
        label="Receiver signature"
        tx={(zh, en) => en}
        value={null}
        onChange={() => {}}
        onClose={onClose}
      />,
    );

    expect(screen.getByText(/SIGN HERE|SIGNATURE AREA/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /fullscreen|landscape/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand src/components/workspace/modules/receipts/generator/mobile-signature-overlay.test.tsx`
Expected: FAIL because component does not exist.

- [ ] **Step 3: Simplify the signature pad API**

In `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/signature-pad.tsx`, remove rotate state and keep only drawing behavior:

```ts
type SignaturePadProps = {
  label: string;
  tx: (zh: string, en: string) => string;
  value: string | null;
  onChange: (value: string | null) => void;
  className?: string;
  canvasClassName?: string;
};
```

Remove:

```ts
const [rotation, setRotation] = useState<0 | 90 | -90>(0);
```

and remove the rotate buttons block entirely.

- [ ] **Step 4: Add the mobile fullscreen overlay**

Create `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/mobile-signature-overlay.tsx`:

```tsx
'use client';

import { Button } from '@/components/ui/button';
import { SignaturePad } from './signature-pad';

export function MobileSignatureOverlay(props: {
  open: boolean;
  label: string;
  tx: (zh: string, en: string) => string;
  value: string | null;
  onChange: (value: string | null) => void;
  onClose: () => void;
  onConfirm?: () => void;
}) {
  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-white">
      <div className="flex items-center justify-between px-4 py-3">
        <Button type="button" variant="outline">{props.tx('横屏/全屏', 'Fullscreen')}</Button>
        <div className="font-medium">{props.label}</div>
        <Button type="button" variant="ghost" onClick={props.onClose}>{props.tx('返回', 'Back')}</Button>
      </div>
      <div className="flex-1 px-4 pb-4">
        <div className="flex h-full flex-col rounded-xl border bg-white">
          <div className="pointer-events-none flex-1 items-center justify-center text-center text-4xl font-semibold tracking-[0.3em] text-slate-200 hidden md:flex">
            SIGN HERE
          </div>
          <div className="relative flex-1">
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-4xl font-semibold tracking-[0.25em] text-slate-200/70">
              SIGN HERE
            </div>
            <SignaturePad
              label={props.label}
              tx={props.tx}
              value={props.value}
              onChange={props.onChange}
              className="h-full border-0 shadow-none"
              canvasClassName="h-full w-full"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire mobile click-to-sign mode into signing view**

In `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/signing-view.tsx`, add:

```ts
const [mobileSigningTarget, setMobileSigningTarget] = useState<null | 'receiver' | 'payer'>(null);
```

Replace mobile inline pad usage with tappable cards:

```tsx
{mobileMode ? (
  <>
    <button type="button" onClick={() => setMobileSigningTarget('receiver')} className="w-full rounded-xl border bg-white p-4 text-left">
      {tx('收款方签名 / Reçu par', 'Receiver signature')}
    </button>
    <button type="button" onClick={() => setMobileSigningTarget('payer')} className="w-full rounded-xl border bg-white p-4 text-left">
      {tx('付款方签名 / Signature du payeur', 'Payer signature')}
    </button>
    <MobileSignatureOverlay
      open={mobileSigningTarget === 'receiver'}
      label={tx('收款方签名 / Reçu par', 'Receiver signature')}
      tx={tx}
      value={receiverSignature}
      onChange={setReceiverSignature}
      onClose={() => setMobileSigningTarget(null)}
    />
    <MobileSignatureOverlay
      open={mobileSigningTarget === 'payer'}
      label={tx('付款方签名 / Signature du payeur', 'Payer signature')}
      tx={tx}
      value={payerSignature}
      onChange={setPayerSignature}
      onClose={() => setMobileSigningTarget(null)}
    />
  </>
) : (
  // existing desktop two-card signing layout
)}
```

- [ ] **Step 6: Run targeted tests**

Run: `npm test -- --runInBand src/components/workspace/modules/receipts/generator/mobile-signature-overlay.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/workspace/modules/receipts/generator/mobile-signature-overlay.tsx \
  src/components/workspace/modules/receipts/generator/mobile-signature-overlay.test.tsx \
  src/components/workspace/modules/receipts/generator/signature-pad.tsx \
  src/components/workspace/modules/receipts/generator/signing-view.tsx
git commit -m "feat: add focused mobile signing mode"
```

### Task 4: Add portrait-safe fullscreen/landscape escalation without rotate controls

**Files:**
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/mobile-signature-overlay.tsx`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/mobile-orientation-hint.tsx`
- Test: `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/mobile-signature-overlay.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/mobile-signature-overlay.test.tsx`:

```tsx
it('calls fullscreen escalation without exposing manual rotate controls', async () => {
  const user = userEvent.setup();
  const requestFullscreen = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
    configurable: true,
    value: requestFullscreen,
  });

  render(
    <MobileSignatureOverlay
      open
      label="Payer signature"
      tx={(zh, en) => en}
      value={null}
      onChange={() => {}}
      onClose={() => {}}
    />,
  );

  await user.click(screen.getByRole('button', { name: /fullscreen|landscape/i }));
  expect(requestFullscreen).toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /rotate/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand src/components/workspace/modules/receipts/generator/mobile-signature-overlay.test.tsx`
Expected: FAIL because fullscreen action is not implemented yet.

- [ ] **Step 3: Implement best-effort fullscreen and landscape lock**

Update `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/mobile-signature-overlay.tsx`:

```ts
async function enterFullscreenLandscape(root: HTMLDivElement | null) {
  if (!root) return;
  const target = root as HTMLDivElement & {
    requestFullscreen?: () => Promise<void>;
    webkitRequestFullscreen?: () => Promise<void>;
  };

  if (target.requestFullscreen) {
    await target.requestFullscreen().catch(() => undefined);
  } else if (target.webkitRequestFullscreen) {
    await target.webkitRequestFullscreen().catch(() => undefined);
  }

  const orientation = screen.orientation as ScreenOrientation | undefined;
  await orientation?.lock?.('landscape').catch(() => undefined);
}
```

Wire it to the top-left action button.

- [ ] **Step 4: Make the hint consistent with the new model**

Update `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/mobile-orientation-hint.tsx`:

```tsx
<div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
  <div className="font-medium">{tx('手机端点击签字框进入全屏签字模式', 'Tap a signature box to enter fullscreen signing mode')}</div>
  <div className="mt-1">
    {tx('竖屏可直接签字；如需更大书写区域，可点击左上角进入全屏/横屏。', 'Portrait signing is allowed. Use the top-left action for fullscreen / landscape if you want more signing space.')}
  </div>
</div>
```

- [ ] **Step 5: Run targeted tests**

Run: `npm test -- --runInBand src/components/workspace/modules/receipts/generator/mobile-signature-overlay.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/workspace/modules/receipts/generator/mobile-signature-overlay.tsx \
  src/components/workspace/modules/receipts/generator/mobile-orientation-hint.tsx \
  src/components/workspace/modules/receipts/generator/mobile-signature-overlay.test.tsx
git commit -m "feat: add portrait-safe fullscreen mobile signing"
```

### Task 5: Extend Playwright to verify desktop popup and mobile full-screen signing flow

**Files:**
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/tests/e2e/receipt-generator.spec.ts`

- [ ] **Step 1: Write the failing mobile test**

Append to `/Users/maotiannan/dev/docker/Trading-Ledger-System/tests/e2e/receipt-generator.spec.ts`:

```ts
test('mobile receipt generator uses full-screen signing overlay and finalizes receipt', async ({ browser, request }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
  });
  const page = await context.newPage();

  await ensureAdminInitialized(request);
  await loginAsAdmin(page);

  const suffix = uniqueSuffix('receipt-gen-mobile');
  const { orderNo } = await createCustomerAndInvoice(page, suffix);

  await page.goto('/receipts');
  await page.getByRole('button', { name: /生成签名收据|Generate Signed Receipt/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('ORDER NO').fill(orderNo);
  await dialog.getByLabel(/收款金额 USD|USD Amount/i).fill('2500');
  await dialog.getByRole('button', { name: /进入签名|Continue to signing/i }).click();

  await page.waitForURL(/\/receipt-generator\//);
  await page.getByRole('button', { name: /Receiver signature/i }).click();
  await expect(page.getByText(/SIGN HERE|SIGNATURE AREA/i)).toBeVisible();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:e2e:isolated -- receipt-generator.spec.ts`
Expected: FAIL because mobile flow still uses inline pads.

- [ ] **Step 3: Finish the mobile flow assertions**

Extend the same test in `/Users/maotiannan/dev/docker/Trading-Ledger-System/tests/e2e/receipt-generator.spec.ts`:

```ts
  await drawSignature(page.locator('canvas').last());
  await page.getByRole('button', { name: /Back/i }).click();
  await page.getByRole('button', { name: /Payer signature/i }).click();
  await drawSignature(page.locator('canvas').last());
  await page.getByRole('button', { name: /Back/i }).click();
  await page.getByRole('button', { name: /Confirm and generate receipt/i }).click();
  await page.waitForURL(/\/receipts$/);
  await expect(page.locator('tr', { hasText: orderNo }).first()).toBeVisible();
```

- [ ] **Step 4: Run isolated E2E**

Run: `npm run test:e2e:isolated`
Expected: PASS with both desktop popup and mobile overlay flow covered.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/receipt-generator.spec.ts
git commit -m "test: cover mobile fullscreen receipt signing"
```

### Task 6: Sync docs, version, local container, and full verification

**Files:**
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/README.md`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/todolist.md`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/ENGINEERING_LOG.md`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/package.json`
- Modify: `/Users/maotiannan/dev/docker/Trading-Ledger-System/package-lock.json`

- [ ] **Step 1: Bump version**

Run:

```bash
npm version 1.0.96 --no-git-tag-version
```

Expected:
- `package.json` version becomes `1.0.96`
- `package-lock.json` version becomes `1.0.96`

- [ ] **Step 2: Update docs**

Apply updates:

```md
README.md:
- 当前版本：`1.0.96`
- 本次更新：签名收据模板已改为与确认版 HTML 样式一致，手机端改为点击签字框进入全屏白底签字模式

todolist.md:
### v1.0.96
- 签名收据模板按确认版 HTML 固化
- 手机端改为逐个签字框进入全屏签字模式，支持竖屏直签与左上角全屏/横屏入口

ENGINEERING_LOG.md:
- v1.0.96（2026-04-28）：签名收据导出模板改为一比一固化确认版 HTML 样式，移除调试栏，仅保留最终模板；手机端签名从 inline pad 改为 per-signature 全屏白底签字模式，加入浅灰英文方向水印与 fullscreen / landscape 尝试逻辑；补齐相关 Jest 与 Playwright 回归
```

- [ ] **Step 3: Run full verification**

Run:

```bash
npm run test:ci
npm run build
```

Expected:
- all Jest tests pass
- isolated API passes unchanged
- Playwright passes including new mobile receipt-generator flow
- production build succeeds

- [ ] **Step 4: Rebuild local service**

Run:

```bash
docker compose up -d --build
docker compose exec -T app sh -lc "node -p \"require('./package.json').version\""
curl -k -I https://localhost
```

Expected:
- app container rebuilt
- container version prints `1.0.96`
- localhost returns `HTTP/2 200`

- [ ] **Step 5: Commit and push**

```bash
git add README.md todolist.md ENGINEERING_LOG.md package.json package-lock.json
git commit -m "feat: align signed receipt template and mobile signing UX"
git push origin main
```

- [ ] **Step 6: Watch CI**

Run:

```bash
gh run watch --repo Maotiannan/Trading-Ledger-System
```

Expected:
- latest `main` CI run completes successfully

