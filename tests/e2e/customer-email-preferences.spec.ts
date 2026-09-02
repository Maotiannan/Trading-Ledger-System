import { expect, test, type Page } from '@playwright/test';
import { ensureAdminInitialized, loginAsAdmin, uniqueSuffix } from './helpers/session';

async function createCustomerFixture(page: Page, suffix: string) {
  const salesResponse = await page.request.post('/api/auth', {
    data: {
      action: 'create',
      email: `${suffix}-sales@example.com`,
      password: 'Sales@2026!',
      role: 'SALES',
      name: `Email UI Sales ${suffix}`,
    },
  });
  expect(salesResponse.ok()).toBeTruthy();
  const sales = await salesResponse.json();
  const salesId = String(sales.data?.id || '');
  expect(salesId).not.toBe('');

  const mark = `EMAIL-UI-${suffix}`.toUpperCase();
  const customerResponse = await page.request.post('/api/customer', {
    data: {
      action: 'create',
      mark,
      orderName: mark,
      name: `Email UI Customer ${suffix}`,
      phone: `624${Math.floor(Math.random() * 900000 + 100000)}`,
      city: 'Conakry',
      ownerId: salesId,
    },
  });
  expect(customerResponse.ok()).toBeTruthy();
  return { mark };
}

async function exerciseCustomerEmailDialog(page: Page, suffix: string) {
  const { mark } = await createCustomerFixture(page, suffix);
  const firstEmail = `${suffix}-primary@example.com`;
  const secondEmail = `${suffix}-accounts@example.com`;

  await page.goto('/customers');
  const search = page.getByPlaceholder(/搜索 mark|Search mark/i);
  await search.fill(mark);
  await search.press('Enter');

  const customerRow = page.locator('tbody tr').filter({ hasText: mark }).first();
  await expect(customerRow).toBeVisible();
  await customerRow.getByRole('button', { name: /未设置邮箱|Email not set/i }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/客户通知邮箱|Customer Notification Emails/i)).toBeVisible();
  const viewport = page.viewportSize();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(box!.height).toBeLessThanOrEqual(viewport!.height);

  const emailInput = dialog.getByPlaceholder(/输入客户邮箱|Enter customer email/i);
  await emailInput.fill(firstEmail);
  await dialog.getByRole('button', { name: /^新增$|^Add$/i }).click();
  await expect(dialog.getByText(firstEmail)).toBeVisible();
  await expect(dialog.getByText(/^(主邮箱|Primary)$/i)).toBeVisible();

  await emailInput.fill(secondEmail);
  await dialog.getByRole('button', { name: /^新增$|^Add$/i }).click();
  await expect(dialog.getByText(secondEmail)).toBeVisible();
  await dialog.getByRole('radio', { name: secondEmail }).click();
  await expect(dialog.getByRole('radio', { name: secondEmail })).toBeChecked();

  await dialog.getByLabel(/语言偏好|Language Preference/i).selectOption('FRENCH');
  await expect(dialog.getByLabel(/语言偏好|Language Preference/i)).toHaveValue('FRENCH');
  const close = dialog.locator('[data-slot="dialog-footer"] button');
  await expect(close).toBeInViewport();
  await close.click();

  await expect(customerRow.getByRole('button', { name: 'Francais' })).toBeVisible();
  await expect(customerRow).toContainText(secondEmail);
}

test('customer notification emails can be maintained on desktop', async ({ page, request }) => {
  await ensureAdminInitialized(request);
  await loginAsAdmin(page);
  await exerciseCustomerEmailDialog(page, uniqueSuffix('email-desktop'));
});

test('customer notification email dialog remains usable on a narrow phone', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ensureAdminInitialized(request);
  await loginAsAdmin(page);
  await exerciseCustomerEmailDialog(page, uniqueSuffix('email-mobile'));
});
