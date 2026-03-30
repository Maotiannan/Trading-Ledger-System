import { expect, test } from '@playwright/test';
import { ensureAdminInitialized, loginAsAdmin } from './helpers/session';

test('dashboard report export downloads file and shows success summary', async ({ page, request }) => {
  await ensureAdminInitialized(request);
  await loginAsAdmin(page);

  await page.goto('/dashboard');

  const dialogPromise = page.waitForEvent('dialog');
  const downloadPromise = page.waitForEvent('download');

  await page.getByTestId('dashboard-export-excel').click();

  const [dialog, download] = await Promise.all([dialogPromise, downloadPromise]);
  expect(dialog.message()).toMatch(/报表导出已生成：当前可见范围内账单|Report export generated: visible invoices/i);
  await dialog.accept();

  expect(download.suggestedFilename()).toMatch(/trading-ledger-report-\d{4}-\d{2}-\d{2}\.xlsx/i);
});
