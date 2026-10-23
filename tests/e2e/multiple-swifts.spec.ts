import { expect, test } from '@playwright/test';
import { ensureAdminInitialized, loginAsAdmin, uniqueSuffix } from './helpers/session';

test('partial SWIFT totals and upload selection fit desktop and mobile', async ({ page, request }) => {
  test.setTimeout(120_000);
  await ensureAdminInitialized(request);
  await loginAsAdmin(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const suffix = uniqueSuffix('multi');
  const detailResponse = await page.request.post('/api/detail', { data: {
    action: 'direct-create', date: '2026-10-21', items: [{ mark: suffix, orderNo: `${suffix}-01`, amount: 75093 }],
  } });
  expect(detailResponse.ok()).toBeTruthy();
  const detailId = (await detailResponse.json()).data.id;
  const first = await page.request.post('/api/swift', { data: { action: 'direct-create', detailId, amount: 50000, date: '2026-10-21', senderName: suffix } });
  expect(first.ok()).toBeTruthy();
  const swiftId = (await first.json()).data.swift.id;
  expect((await page.request.post('/api/swift', { data: { action: 'mark-received', swiftId } })).ok()).toBeTruthy();
  await page.goto('/details');
  const search = page.getByPlaceholder(/搜索|Search/).filter({ visible: true }).first();
  await search.fill(`${suffix}-01`);
  await search.press('Enter');
  await expect(page.getByText('SWIFT: $50,000', { exact: true })).toBeVisible();
  await expect(page.getByText('Waiting_SWIFT', { exact: true })).toBeVisible();
  await expect(page.getByText(/(?:余额|Balance): \$25,093/)).toBeVisible();
  const swiftTotal = page.getByText('SWIFT: $50,000', { exact: true });
  await expect(swiftTotal).toHaveClass(/text-green-600/);
  let detailReloads = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/detail') detailReloads += 1;
  });
  await swiftTotal.hover();
  await expect(page.getByRole('tooltip')).toContainText('SWIFT 1: RECEIVED');
  await page.screenshot({ path: '/tmp/muledger-multiple-swifts-desktop.png' });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTitle(/收起侧边栏|Collapse Sidebar/).click();
  await expect(swiftTotal).toBeVisible();
  await expect(async () => {
    const amountBounds = await swiftTotal.boundingBox();
    expect(amountBounds!.x + amountBounds!.width).toBeLessThanOrEqual(390);
  }).toPass();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/muledger-multiple-swifts-mobile.png' });
  expect(detailReloads).toBeLessThanOrEqual(1);
  await page.goto('/swifts');
  await page.getByRole('button', { name: /^直接创建$|^Create Directly$/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('select option', { hasText: '$75,093' })).toHaveCount(1);
  await dialog.locator('select').selectOption(detailId);
  await expect(dialog.getByText('SWIFT: $50,000', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/(?:余额|Balance): \$25,093/)).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds).toBeTruthy();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  await dialog.getByPlaceholder(/^汇款金额$|^Amount$/).fill('25093');
  await dialog.getByPlaceholder(/^付款人姓名$|^Sender Name$/).fill(`${suffix}-second`);
  await dialog.getByRole('button', { name: /^创建$|^Create$/ }).click();
  await expect(dialog).not.toBeVisible();
  const listed = await page.request.get('/api/swift');
  const copies = (await listed.json()).data.filter((swift: { detailId: string }) => swift.detailId === detailId);
  expect(copies).toHaveLength(2);
  expect(copies.find((swift: { id: string }) => swift.id === swiftId).status).toBe('RECEIVED');
  expect(errors).toEqual([]);
});
