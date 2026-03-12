import { expect, test } from '@playwright/test';
import { ensureAdminInitialized, loginAsAdmin } from './helpers/session';

test('settings page renders password, user management, and system config sections', async ({ page, request }) => {
  await ensureAdminInitialized(request);
  await loginAsAdmin(page);

  await page.goto('/settings');
  await expect(page.getByText(/当前版本|Current Version/i)).toBeVisible();
  await expect(page.getByText(/v\d+\.\d+\.\d+/i)).toHaveCount(1);
  await expect(page.getByText(/修改密码|Change Password/i)).toBeVisible();
  await expect(page.getByText(/用户管理|User Management/i).first()).toBeVisible();
  await expect(page.getByText(/系统配置|System Configuration/i).first()).toBeVisible();
  await expect(page.getByText(/配置变更审计|Configuration Audit/i).first()).toBeVisible();
  await expect(async () => {
    const emptyStateVisible = await page.getByText(/暂无配置审计记录|No configuration audit logs yet/i).isVisible().catch(() => false);
    const refreshAuditVisible = await page.getByRole('button', { name: /刷新审计|Refresh Audit/i }).isVisible().catch(() => false);
    expect(emptyStateVisible || refreshAuditVisible).toBeTruthy();
  }).toPass();
});
