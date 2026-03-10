import { expect, test } from '@playwright/test';
import { ensureAdminInitialized, loginAsAdmin, uniqueSuffix } from './helpers/session';

test('admin can create a customer and invoice from the workspace UI', async ({ page, request }) => {
  await ensureAdminInitialized(request);
  await loginAsAdmin(page);

  const suffix = uniqueSuffix('ui');
  const mark = `MARK-${suffix}`;
  const orderName = `ORDER-${suffix}`;
  const invoiceNo = `INV-${suffix}`;
  const phone = `620${Math.floor(Math.random() * 900000 + 100000)}`;

  await page.goto('/customers');
  await page.getByRole('button', { name: /新建客户|New Customer/i }).click();
  const customerDialog = page.getByRole('dialog');
  await customerDialog.getByPlaceholder(/^MARK\*$/).fill(mark);
  await customerDialog.getByPlaceholder(/^ORDER_NAME\*$/).fill(orderName);
  await customerDialog.getByPlaceholder(/^NAME\*$/).fill(`Customer ${suffix}`);
  await customerDialog.getByPlaceholder(/^PHONE\*$/).fill(phone);
  await customerDialog.getByPlaceholder(/^CITY\*$/).fill('Conakry');
  await customerDialog.getByRole('button', { name: /保存|Save/i }).click();

  await expect(page.getByText(mark)).toBeVisible();
  await expect(page.getByText(orderName)).toBeVisible();

  await page.goto('/invoices');
  await page.getByRole('button', { name: /直接创建账单|Create Invoice/i }).click();
  const invoiceDialog = page.getByRole('dialog');
  await invoiceDialog.getByPlaceholder(/e\.g\.|L25MH090125/i).fill(invoiceNo);
  await invoiceDialog.getByPlaceholder(/客户单号|Order No/i).fill(`${mark}-01`);
  await invoiceDialog.getByPlaceholder(/金额|Amount/i).fill('1200');
  await invoiceDialog.getByPlaceholder(/客户MARK|Customer MARK/i).fill(mark);
  await invoiceDialog.getByRole('button', { name: /^创建$|^Create$/i }).click();

  await expect(page.getByText(invoiceNo)).toBeVisible();
});
