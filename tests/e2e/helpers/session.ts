import { expect, type APIRequestContext, type Page } from '@playwright/test';

const initToken = process.env.PW_TEST_INIT_TOKEN || 'test-init-token';
const adminEmail = process.env.PW_TEST_ADMIN_EMAIL || 'admin@example.com';
const adminPassword = process.env.PW_TEST_ADMIN_PASSWORD || 'Admin@2026!';

export function uniqueSuffix(prefix = 'pw') {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

export async function ensureAdminInitialized(request: APIRequestContext) {
  const response = await request.post('/api/init', {
    headers: { 'x-init-token': initToken },
  });
  expect(response.ok()).toBeTruthy();
}

export async function loginAsAdmin(page: Page) {
  await page.goto('/');
  await page.getByLabel(/邮箱|Email/i).fill(adminEmail);
  await page.getByLabel(/密码|Password/i).fill(adminPassword);
  await page.getByRole('button', { name: /登录|log in|login/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}
