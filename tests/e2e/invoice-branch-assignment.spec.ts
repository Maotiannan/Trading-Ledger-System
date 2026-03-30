import { expect, test, type Page } from '@playwright/test';
import { ensureAdminInitialized, loginAsAdmin, uniqueSuffix } from './helpers/session';

async function loginWithCredentials(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.getByLabel(/邮箱|Email/i).fill(email);
  await page.getByLabel(/密码|Password/i).fill(password);
  await page.getByRole('button', { name: /登录|log in|login/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function logout(page: Page) {
  await page.getByRole('button', { name: /退出登录|Log Out/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

test('admin can assign invoice ownership to a branch admin from the invoice UI', async ({ page, request }) => {
  await ensureAdminInitialized(request);
  await page.addInitScript(() => {
    const capturedAlerts: string[] = [];
    Object.defineProperty(window, '__capturedAlerts', {
      value: capturedAlerts,
      configurable: true,
    });
    window.alert = (message?: string) => {
      capturedAlerts.push(String(message ?? ''));
    };
  });
  await loginAsAdmin(page);

  const suffix = uniqueSuffix('assign');
  const mark = `ASSIGN-${suffix}`;
  const invoiceNo = `INV-${suffix}`;
  const orderNo = `${mark}-01`;
  const branchAdminEmail = `${suffix}-branch-admin@example.com`;
  const branchAdminPassword = 'BranchAdmin@2026!';
  const salesEmail = `${suffix}-sales@example.com`;

  const branchAdminResponse = await page.request.post('/api/auth', {
    data: {
      action: 'create',
      email: branchAdminEmail,
      password: branchAdminPassword,
      role: 'ADMIN',
      name: `Branch Admin ${suffix}`,
    },
  });
  expect(branchAdminResponse.ok()).toBeTruthy();
  const branchAdminPayload = await branchAdminResponse.json();
  const branchAdminId = String(branchAdminPayload?.data?.id || branchAdminPayload?.data?.data?.id || '');
  expect(branchAdminId).not.toBe('');

  const salesResponse = await page.request.post('/api/auth', {
    data: {
      action: 'create',
      email: salesEmail,
      password: 'Sales@2026!',
      role: 'SALES',
      name: `Sales ${suffix}`,
      parentId: branchAdminId,
    },
  });
  expect(salesResponse.ok()).toBeTruthy();
  const salesPayload = await salesResponse.json();
  const salesId = String(salesPayload?.data?.id || salesPayload?.data?.data?.id || '');
  expect(salesId).not.toBe('');

  const customerResponse = await page.request.post('/api/customer', {
    data: {
      action: 'create',
      mark,
      orderName: mark,
      name: `Customer ${suffix}`,
      phone: `620${Math.floor(Math.random() * 900000 + 100000)}`,
      city: 'Conakry',
      ownerId: salesId,
    },
  });
  expect(customerResponse.ok()).toBeTruthy();

  const invoiceCreateResponse = await page.request.post('/api/invoice', {
    data: {
      invNo: invoiceNo,
      shipDate: '2026-03-30',
      releaseDate: '2026-03-31',
      orders: [{ orderNo, amount: 1200, customerMark: mark, customerName: mark }],
    },
  });
  expect(invoiceCreateResponse.ok()).toBeTruthy();

  const invoiceListResponse = await page.request.get(`/api/invoice?search=${encodeURIComponent(invoiceNo)}`);
  expect(invoiceListResponse.ok()).toBeTruthy();
  const invoiceListPayload = await invoiceListResponse.json();
  const invoice = Array.isArray(invoiceListPayload?.data)
    ? invoiceListPayload.data.find((row: { invNo?: string }) => row.invNo === invoiceNo)
    : null;
  expect(invoice?.id).toBeTruthy();

  await page.goto('/invoices');
  await page.getByText(invoiceNo).click();
  await page.getByTestId(`invoice-assign-admin-select-${invoice.id}`).click();
  await page.getByRole('option', { name: new RegExp(branchAdminEmail, 'i') }).click();

  await page.getByTestId(`invoice-assign-admin-button-${invoice.id}`).click();
  await expect
    .poll(() => page.evaluate(() => ((window as Window & { __capturedAlerts?: string[] }).__capturedAlerts || []).at(-1) || ''))
    .toMatch(/账单归属已分配|Invoice ownership assigned/i);

  await logout(page);
  await loginWithCredentials(page, branchAdminEmail, branchAdminPassword);
  await page.goto('/invoices');
  await expect(page.getByText(invoiceNo)).toBeVisible();
});
