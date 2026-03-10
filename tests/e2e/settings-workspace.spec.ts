import { expect, test } from '@playwright/test';
import { ensureAdminInitialized, loginAsAdmin } from './helpers/session';

test('settings page renders password, user management, and system config sections', async ({ page, request }) => {
  await ensureAdminInitialized(request);
  await loginAsAdmin(page);

  await page.goto('/settings');
  await expect(page.getByText(/修改密码|Change Password/i)).toBeVisible();
  await expect(page.getByText(/用户管理|User Management/i).first()).toBeVisible();
  await expect(page.getByText(/系统配置|System Configuration/i).first()).toBeVisible();
});
