// Browser plugin not available. Local Playwright uses synthetic DB data only.
import { chromium, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import fs from 'node:fs';
assert.equal(process.env.DATABASE_URL, 'mysql://root:isolated237-only@127.0.0.1:3323/muledger237_test');
const db = new PrismaClient();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
const base = process.env.ISOLATED_237_BASE_URL || 'http://127.0.0.1:3324';
assert.ok(['http://127.0.0.1:3324', 'http://127.0.0.1:3326'].includes(base));
const run = `ui237-${Date.now()}`;
const password = 'Isolated237-test!';
const output = 'out/implementation-20261113';
async function login(email) {
  const res = await context.request.post(base + '/api/auth', { data: { action: 'login', email, password } });
  assert.ok(res.ok(), await res.text());
}
async function fits(width) {
  const dialog = page.getByRole('dialog');
  await expect.poll(async () => { const box = await dialog.boundingBox(); return box.x >= 0 && box.x + box.width <= width + 1; }).toBe(true);
  await expect.poll(() => dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
}
try {
  const user = await db.user.create({ data: { email: `${run}@example.test`, password: await bcrypt.hash(password, 4), role: 'USER', level: 3, parentId: 'isolated237-admin' } });
  const customer = await db.customer.create({ data: { mark: run, normalizedMark: run, orderName: run, name: run, phone: '', city: '', ownerId: user.id, createdBy: user.id } });
  const pool = await db.invoice.findUniqueOrThrow({ where: { invNo: 'DEPOSIT_POOL' } });
  const order = await db.order.create({ data: { orderNo: `${run}-SOURCE`, customerId: customer.id, invoiceId: pool.id, paymentAllocationMode: true, amount: 0, orderBalance: 0, createdBy: user.id } });
  const receipt = await db.receipt.create({ data: { orderId: order.id, orderNo: order.orderNo, receiptNo: run, customerId: customer.id, usd: 3000, status: 'RECEIVED', createdBy: user.id } });
  const source = await db.prepaymentSource.create({ data: { customerId: customer.id, orderId: order.id, originalOrderNo: order.orderNo, normalizedOrderNo: order.orderNo.toUpperCase() } });
  const root = await db.receiptFunding.create({ data: { receiptId: receipt.id, originalReceiptId: receipt.id, originalOrderId: order.id, originalCustomerId: customer.id, receivedAmount: 3000, receiptSnapshot: { synthetic: true } } });
  const credit = await db.prepaymentCredit.create({ data: { fundingId: root.id, sourceId: source.id, customerId: customer.id, amount: 3000 } });
  const tracker = await db.orderTracker.create({ data: { orderNo: `${run}-TARGET`, normalizedOrderNo: `${run}-TARGET`, customerId: customer.id, createdBy: user.id } });
  await login('237@example.test');
  await page.goto(base + '/invoices');
  await page.getByText('DEPOSIT_POOL', { exact: true }).click();
  await expect(page.getByRole('button', { name: /显示已使用记录|Show Used Records/ })).toBeVisible();
  await page.screenshot({ path: `${output}/pool-desktop.png` });
  const row = page.getByRole('row').filter({ hasText: order.orderNo });
  await row.getByRole('button', { name: /^转移$|^Transfer$/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel(/搜索目标订单|Search target order/)).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 }); await fits(width);
    await page.screenshot({ path: `${output}/pool-transfer-${width}.png` });
  }
  await dialog.getByLabel(/搜索目标订单|Search target order/).fill(tracker.orderNo);
  await dialog.getByRole('button', { name: /^搜索$|^Search$/ }).click();
  await dialog.getByRole('button', { name: new RegExp(tracker.orderNo) }).click();
  await dialog.getByLabel(/转移金额|Transfer amount/).fill('1000');
  await dialog.getByLabel(/原因|Reason/).fill(run);
  await dialog.getByRole('button', { name: /确认转移|Confirm transfer/ }).click();
  await expect(dialog.getByText(/操作成功|Completed/)).toBeVisible();
  await expect(dialog.getByLabel(/搜索目标订单|Search target order/)).toHaveCount(0);
  assert.equal((await db.prepaymentCredit.findUniqueOrThrow({ where: { id: credit.id } })).amount.toFixed(2), '2000.00');
  await dialog.locator('summary').click();
  await dialog.getByText(run, { exact: false }).filter({ hasText: /1,000/ }).last().locator('..')
    .getByRole('button', { name: /撤销转移|Reverse transfer/ }).click();
  await dialog.getByLabel(/原因|Reason/).fill('Synthetic reversal');
  await dialog.getByRole('button', { name: /确认撤销|Confirm reversal/ }).click();
  await expect(dialog.getByText(/操作成功|Completed/)).toBeVisible();
  assert.equal((await db.prepaymentCredit.findUniqueOrThrow({ where: { id: credit.id } })).amount.toFixed(2), '3000.00');
  assert.equal(await db.receipt.count({ where: { customerId: customer.id } }), 1);
  await page.keyboard.press('Escape');
  await page.getByTitle(/收起侧边栏|Collapse Sidebar/).click();
  const evidence = JSON.parse(fs.readFileSync(`${output}/api-results.json`, 'utf8'));
  await page.getByText(`${evidence.run}-INV`, { exact: true }).click();
  await page.getByRole('button', { name: `${evidence.run}-A1/${evidence.run}-A2`.toUpperCase(), exact: true }).click();
  await expect(dialog.getByText(`${evidence.run}-R1`, { exact: true })).toBeVisible();
  await expect(dialog.getByText('$3,000', { exact: true })).toBeVisible();
  await fits(320); await page.screenshot({ path: `${output}/payment-records-320.png` });
  await login(user.email); await page.reload();
  await page.getByText('DEPOSIT_POOL', { exact: true }).click();
  await expect(page.getByRole('button', { name: order.orderNo.toUpperCase(), exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^转移$|^Transfer$|转移与记录|Transfers & History/ })).toHaveCount(0);
  await page.screenshot({ path: `${output}/pool-readonly-320.png` });
  assert.deepEqual(errors, []);
  fs.writeFileSync(`${output}/browser-results.json`, JSON.stringify({ status: 'PASS', run, widths: [1440, 390, 320],
    flow: 'pool -> preselected transfer -> success without reselection -> reversal -> original allocated receipt -> readonly user', errors }, null, 2));
  console.log('PASS desktop/mobile pool, transfer/reversal, allocated receipt and scoped read-only UI');
} catch (error) {
  await page.screenshot({ path: `${output}/browser-failure.png` });
  console.error((await page.locator('body').innerText()).slice(-3500));
  throw error;
} finally { await browser.close(); await db.$disconnect(); }
