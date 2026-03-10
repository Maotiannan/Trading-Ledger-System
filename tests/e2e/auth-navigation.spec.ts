import { expect, test } from '@playwright/test';
import { ensureAdminInitialized, loginAsAdmin } from './helpers/session';

test('admin can login, navigate modules, and collapse sidebar', async ({ page, request }) => {
  await ensureAdminInitialized(request);
  await loginAsAdmin(page);

  await expect(page.getByText(/收汇管理系统|Trading Ledger System/i)).toBeVisible();

  await page.getByRole('button', { name: /账单管理|Invoice Management|Invoices/i }).click();
  await expect(page).toHaveURL(/\/invoices$/);
  await expect(page.getByText(/账单管理|Invoice Management|Invoices/i).first()).toBeVisible();

  await page.getByTitle(/收起侧边栏|Collapse Sidebar/i).click();
  await expect(page.getByText('MU')).toBeVisible();

  await page.getByTitle(/展开侧边栏|Expand Sidebar/i).click();
  await page.getByRole('button', { name: /设置|Settings/i }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByText(/设置|Settings/i).first()).toBeVisible();
});
