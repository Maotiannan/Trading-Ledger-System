import { expect, test, type Page } from '@playwright/test';
import { ensureAdminInitialized, loginAsAdmin, uniqueSuffix } from './helpers/session';

const salesPassword = 'Sales@2026!';

async function setupPendingEmailTask(page: Page, suffix: string) {
  const salesEmail = `${suffix}-sales@example.com`;
  const salesResponse = await page.request.post('/api/auth', {
    data: {
      action: 'create',
      email: salesEmail,
      password: salesPassword,
      role: 'SALES',
      name: `Email Management Sales ${suffix}`,
    },
  });
  expect(salesResponse.ok()).toBeTruthy();
  const sales = await salesResponse.json();
  const salesId = String(sales.data?.id || '');

  const mark = `EMAIL-MANAGER-${suffix}`.toUpperCase();
  const customerResponse = await page.request.post('/api/customer', {
    data: {
      action: 'create',
      mark,
      orderName: mark,
      name: `Email Management Customer ${suffix}`,
      phone: `625${Math.floor(Math.random() * 900000 + 100000)}`,
      city: 'Conakry',
      ownerId: salesId,
    },
  });
  expect(customerResponse.ok()).toBeTruthy();
  const customer = await customerResponse.json();
  const customerId = String(customer.data?.id || '');
  const recipient = `${suffix}-customer@example.com`;
  const emailResponse = await page.request.post('/api/customer-notification-emails', {
    data: { action: 'add', customerId, email: recipient },
  });
  expect(emailResponse.ok()).toBeTruthy();

  const receiptNo = `EMAIL-MANAGEMENT-${suffix}`.toUpperCase();
  const orderNo = `${mark}-01`;
  const receiptResponse = await page.request.post('/api/receipt', {
    data: {
      action: 'direct-create',
      receiptNo,
      date: '2026-09-01',
      usd: 980,
      orderNo,
      customerId,
      customerMark: mark,
      customerName: `Email Management Customer ${suffix}`,
      isDeposit: false,
    },
  });
  expect(receiptResponse.ok()).toBeTruthy();

  const settingsResponse = await page.request.post('/api/email-settings', {
    data: {
      action: 'save-settings',
      settings: {
        outboundEnabled: true,
        recipientMode: 'PRIMARY_CC',
        senderName: 'MU LEDGER',
        senderAddress: 'sender@example.com',
        replyToAddress: 'reply@example.com',
        retryLimit: 1,
        retryIntervalsSeconds: [1],
        testModeEnabled: true,
        testDestination: 'test-destination@example.com',
        logoUrl: 'https://127.0.0.1/isolated-test-logo.svg',
      },
    },
  });
  expect(settingsResponse.ok()).toBeTruthy();

  const tasksResponse = await page.request.get(`/api/email-notifications?search=${encodeURIComponent(receiptNo)}`);
  expect(tasksResponse.ok()).toBeTruthy();
  const tasks = await tasksResponse.json();
  const notificationId = String(tasks.data?.[0]?.id || '');
  expect(notificationId).not.toBe('');
  return { notificationId, receiptNo, recipient, salesEmail };
}

test('ADMIN previews recipients and explicitly approves a test-mode email', async ({ page, request }) => {
  await ensureAdminInitialized(request);
  await loginAsAdmin(page);
  const fixture = await setupPendingEmailTask(page, uniqueSuffix('email-admin'));

  const fakeBaseUrl = process.env.RESEND_FAKE_CONTROL_BASE_URL;
  expect(fakeBaseUrl).toBeTruthy();
  const controlHeaders = { 'x-control-token': process.env.RESEND_FAKE_CONTROL_TOKEN || '' };
  const resetResponse = await request.post(`${fakeBaseUrl}/__control/reset`, { headers: controlHeaders, data: {} });
  expect(resetResponse.ok()).toBeTruthy();

  await page.getByTestId('sidebar-nav-emails').click();
  await expect(page).toHaveURL(/\/emails$/);
  await expect(page.getByTestId('email-manager')).toBeVisible();
  await page.getByLabel(/客户.*MARK.*ORDER|Customer.*MARK.*ORDER/i).fill(fixture.receiptNo);
  await page.getByRole('button', { name: /^查询$|^Search$/i }).click();

  const row = page.getByTestId(`email-row-${fixture.notificationId}`);
  await expect(row).toBeVisible();
  await page.getByTestId(`email-preview-${fixture.notificationId}`).click();

  const preview = page.getByTestId('email-preview-dialog');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(fixture.recipient);
  await expect(preview).toContainText('test-destination@example.com');
  await expect(preview.locator('iframe')).toHaveAttribute('sandbox', '');
  await expect(preview.getByTestId('email-preview-send')).toBeInViewport();
  await preview.getByTestId('email-preview-send').click();

  const confirmation = page.getByTestId('email-send-confirmation');
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText(fixture.recipient);
  await expect(confirmation).toContainText('test-destination@example.com');
  await confirmation.getByTestId('email-confirm-send').click();
  await expect(confirmation).toBeHidden();
  await expect(row).toContainText(/等待发送|Queued/i);

  const recordedResponse = await request.get(`${fakeBaseUrl}/__control/requests`, { headers: controlHeaders });
  expect(recordedResponse.ok()).toBeTruthy();
  const recorded = await recordedResponse.json();
  expect(recorded.requests).toEqual([]);
});

test('SALES cannot see or navigate to Email Management', async ({ page, request }) => {
  await ensureAdminInitialized(request);
  await loginAsAdmin(page);
  const fixture = await setupPendingEmailTask(page, uniqueSuffix('email-sales-guard'));
  await page.request.post('/api/auth', { data: { action: 'logout' } });

  await page.goto('/');
  await page.getByLabel(/邮箱|Email/i).fill(fixture.salesEmail);
  await page.getByLabel(/密码|Password/i).fill(salesPassword);
  await page.getByRole('button', { name: /登录|log in|login/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId('sidebar-nav-emails')).toHaveCount(0);

  await page.goto('/emails');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId('email-manager')).toHaveCount(0);
});
