import { expect, test } from '@playwright/test';
import { ensureAdminInitialized, loginAsAdmin, uniqueSuffix } from './helpers/session';

test('Orders inline PI and confirmed deletion work on desktop and mobile', async ({ page, request }) => {
  test.setTimeout(120_000);
  await ensureAdminInitialized(request);
  await loginAsAdmin(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const mark = uniqueSuffix('ORDERS').toUpperCase();
  const orderNo = `${mark}-01`;
  const customer = await page.request.post('/api/customer', { data: {
    action: 'create', mark, orderName: mark, name: mark, phone: '622000001', city: 'Conakry',
  } });
  expect(customer.ok()).toBeTruthy();
  const created = await page.request.post('/api/orders', { data: {
    action: 'create', orderNo, customerId: (await customer.json()).data.id,
  } });
  expect(created.ok()).toBeTruthy();
  await page.goto('/orders');
  const checkbox = page.getByRole('checkbox', { name: new RegExp(orderNo) });
  await expect(checkbox).toBeVisible();
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await expect(page.getByText(/PI状态已保存|PI status saved/)).toBeVisible();
  await page.reload();
  await expect(checkbox).toBeChecked();
  await page.screenshot({ path: '/tmp/muledger-orders-desktop.png', animations: 'disabled' });

  await page.setViewportSize({ width: 390, height: 844 });
  const collapse = page.getByTitle(/收起侧边栏|Collapse Sidebar/);
  if (await collapse.isVisible()) await collapse.click();
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
  const trash = page.getByRole('button', { name: new RegExp(`(?:删除订单|Delete order) ${orderNo}`) });
  await trash.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '/tmp/muledger-orders-mobile-delete.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: /^取消$|^Cancel$/ }).click();
  await expect(checkbox).toBeAttached();
  await trash.click();
  await dialog.getByRole('button', { name: /^删除$|^Delete$/ }).click();
  await expect(dialog).not.toBeVisible();
  await expect(checkbox).not.toBeAttached();
  await page.reload();
  await expect(checkbox).not.toBeAttached();
  expect(errors).toEqual([]);
});
