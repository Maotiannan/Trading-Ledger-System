import { expect, test, type Locator, type Page } from '@playwright/test';
import { ensureAdminInitialized, loginAsAdmin, uniqueSuffix } from './helpers/session';

async function drawSignature(canvas: Locator) {
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error('Signature canvas is not visible');
  }

  const startX = box.x + box.width * 0.2;
  const startY = box.y + box.height * 0.55;
  const endX = box.x + box.width * 0.8;
  const endY = box.y + box.height * 0.35;
  const midX = box.x + box.width * 0.55;
  const midY = box.y + box.height * 0.75;

  await canvas.page().mouse.move(startX, startY);
  await canvas.page().mouse.down();
  await canvas.page().mouse.move(midX, midY, { steps: 6 });
  await canvas.page().mouse.move(endX, endY, { steps: 6 });
  await canvas.page().mouse.up();
}

async function createCustomerAndInvoice(page: Page, suffix: string) {
  const api = page.context().request;
  const mark = `SGR-${suffix}`;
  const orderNo = `${mark}-01`;
  const invNo = `INV-${suffix}`;

  const createCustomer = await api.post('/api/customer', {
    data: {
      action: 'create',
      mark,
      orderName: mark,
      name: `Signed Receipt ${suffix}`,
      phone: `623${Math.floor(Math.random() * 900000 + 100000)}`,
      city: 'Conakry',
    },
  });
  expect(createCustomer.ok()).toBeTruthy();

  const createInvoice = await api.post('/api/invoice', {
    data: {
      invNo,
      orders: [
        {
          orderNo,
          amount: 2500,
          customerMark: mark,
          customerName: mark,
        },
      ],
    },
  });
  expect(createInvoice.ok()).toBeTruthy();

  return { mark, orderNo, invNo };
}

test('admin can generate a signed receipt and return to receipt list with attached image', async ({ page, request }) => {
  await ensureAdminInitialized(request);
  await loginAsAdmin(page);

  const suffix = uniqueSuffix('receipt-gen');
  const { orderNo, invNo } = await createCustomerAndInvoice(page, suffix);

  await page.goto('/receipts');
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: /生成签名收据|Generate Signed Receipt/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('ORDER NO').fill(orderNo);
  await dialog.getByLabel(/收款金额 USD|USD Amount/i).fill('2500');
  await expect(dialog.getByLabel('ORDER NO')).toHaveValue(orderNo);
  await expect(dialog.getByText(invNo)).toBeVisible();
  await expect(dialog.getByText('$2,500').first()).toBeVisible();
  await dialog.getByRole('button', { name: /进入签名|Continue to signing/i }).click();

  const popup = await popupPromise;
  await popup.waitForURL(/\/receipt-generator\//);
  await expect(popup.getByText(/签名收据|Signed Receipt/i)).toBeVisible();
  const receiverCanvas = popup.locator('[data-testid="receiver-signature-pad"] canvas');
  const receiverBox = await receiverCanvas.boundingBox();
  expect(receiverBox?.width ?? 0).toBeGreaterThan(200);
  expect(receiverBox?.width ?? 0).toBeLessThan(700);
  expect(receiverBox?.height ?? 0).toBeGreaterThan(80);
  expect(receiverBox?.height ?? 0).toBeLessThan(260);

  const downloadPromise = popup.waitForEvent('download');
  await drawSignature(receiverCanvas);
  await drawSignature(popup.locator('[data-testid="payer-signature-pad"] canvas'));
  const finalizeButton = popup.getByRole('button', { name: /确认并生成收据|Confirm and generate receipt/i });
  await popup.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await finalizeButton.evaluate((button: HTMLButtonElement) => button.click());

  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/001\d{4}\.png$/);

  await expect.poll(() => popup.isClosed()).toBeTruthy();

  const receiptRow = page.locator('tr', { hasText: orderNo }).first();
  await expect(receiptRow).toBeVisible();
  await expect(receiptRow.getByTitle(/查看图片|View image/i)).toBeVisible();
  await expect(receiptRow.getByTitle(/继续签名|Resume signing/i)).toHaveCount(0);

  const receiptNo = (await receiptRow.locator('td').first().textContent())?.trim();
  expect(receiptNo && receiptNo !== '-').toBeTruthy();
});

test.describe('mobile signed receipt flow', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test('admin can complete the same-tab focused mobile signing flow and return to receipts', async ({ page, request }) => {
    await ensureAdminInitialized(request);
    await loginAsAdmin(page);

    const suffix = uniqueSuffix('receipt-gen-mobile');
    const { orderNo, invNo } = await createCustomerAndInvoice(page, suffix);

    await page.goto('/receipts');
    await page.getByRole('button', { name: /生成签名收据|Generate Signed Receipt/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('ORDER NO').fill(orderNo);
    await dialog.getByLabel(/收款金额 USD|USD Amount/i).fill('2500');
    await expect(dialog.getByText(invNo)).toBeVisible();
    await dialog.getByRole('button', { name: /进入签名|Continue to signing/i }).click();

    await page.waitForURL(/\/receipt-generator\//);
    await expect(page.getByText(/签名收据|Signed Receipt/i)).toBeVisible();
    await expect(page.getByTestId('mobile-orientation-hint')).toBeVisible();
    await expect(page.getByRole('button', { name: /开始收款方签名|Start receiver signature/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /开始付款方签名|Start payer signature/i })).toBeVisible();
    await expect(page.getByTestId('receiver-signature-pad')).toHaveCount(0);
    await expect(page.getByTestId('payer-signature-pad')).toHaveCount(0);

    await page.getByRole('button', { name: /开始收款方签名|Start receiver signature/i }).click();
    const receiverMode = page.getByTestId('mobile-signature-mode');
    await expect(receiverMode).toBeVisible();
    await expect(receiverMode.getByTestId('mobile-signature-watermark')).toContainText('Signature in the highlighted area');
    await expect(receiverMode.getByRole('button', { name: /全屏|Fullscreen/i })).toBeVisible();
    await drawSignature(receiverMode.locator('canvas'));
    await receiverMode.getByRole('button', { name: /完成|Complete/i }).click();
    await expect(receiverMode).toHaveCount(0);
    await expect(page.getByText(/已签名|Signed/i).first()).toBeVisible();

    await page.getByRole('button', { name: /开始付款方签名|Start payer signature/i }).click();
    const payerMode = page.getByTestId('mobile-signature-mode');
    await expect(payerMode).toBeVisible();
    await expect(payerMode.getByRole('button', { name: /全屏|Fullscreen/i })).toBeVisible();
    await drawSignature(payerMode.locator('canvas'));
    await payerMode.getByRole('button', { name: /完成|Complete/i }).click();
    await expect(payerMode).toHaveCount(0);

    await page.getByRole('button', { name: /确认并生成收据|Confirm and generate receipt/i }).click();
    await page.waitForURL(/\/receipts$/);

    const receiptRow = page.locator('tr', { hasText: orderNo }).first();
    await expect(receiptRow).toBeVisible();
    await expect(receiptRow.getByTitle(/查看图片|View image/i)).toBeVisible();
    await expect(receiptRow.getByTitle(/继续签名|Resume signing/i)).toHaveCount(0);
  });
});
