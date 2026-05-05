import { expect, test, type APIRequestContext } from '@playwright/test';
import { ensureAdminInitialized, loginAsAdmin } from './helpers/session';

test('settings page renders password, user management, and system config sections', async ({ page, request }) => {
  await ensureAdminInitialized(request);
  await loginAsAdmin(page);

  await page.goto('/settings');
  await expect(page.getByText(/当前版本|Current Version/i)).toBeVisible();
  await expect(page.getByText(/v\d+\.\d+\.\d+/i)).toHaveCount(1);
  const passwordSection = page.getByRole('button', { name: /修改密码|Change Password/i });
  const userSection = page.getByRole('button', { name: /用户管理|User Management/i });
  const systemConfigSection = page.getByRole('button', { name: /系统配置|System Configuration/i });
  const auditSection = page.getByRole('button', { name: /设置审计|Settings Audit|配置变更审计|Configuration Audit/i });

  await expect(passwordSection).toBeVisible();
  await expect(userSection).toBeVisible();
  await expect(systemConfigSection).toBeVisible();
  await expect(auditSection).toBeVisible();

  await auditSection.click();
  await expect(async () => {
    const emptyStateVisible = await page.getByText(/暂无配置审计记录|No configuration audit logs yet/i).isVisible().catch(() => false);
    const refreshAuditVisible = await page.getByRole('button', { name: /刷新审计|Refresh Audit/i }).isVisible().catch(() => false);
    expect(emptyStateVisible || refreshAuditVisible).toBeTruthy();
  }).toPass();
});

async function getCurrentSettings(api: APIRequestContext) {
  const response = await api.get('/api/settings');
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  return payload.data.settings as Record<string, string>;
}

async function updateSettings(api: APIRequestContext, settings: Record<string, string>) {
  const response = await api.post('/api/settings', {
    data: {
      action: 'update-config',
      settings,
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.success).toBeTruthy();
}

test('settings audit supports filtering, export history, and load-more pagination', async ({ page, request }) => {
  await ensureAdminInitialized(request);
  await loginAsAdmin(page);

  const api = page.context().request;
  const targetKey = 'DETAIL_RECEIPT_MATCH_TOLERANCE';
  const adminEmail = process.env.PW_TEST_ADMIN_EMAIL || 'admin@example.com';
  let settings = await getCurrentSettings(api);
  for (let index = 0; index < 21; index += 1) {
    settings = {
      ...settings,
      [targetKey]: String(100 + index),
    };
    await updateSettings(api, settings);
  }

  await page.goto('/settings');

  await page.getByRole('button', { name: /设置审计|Settings Audit|配置变更审计|Configuration Audit/i }).click();

  const auditCard = page.getByTestId('settings-audit-card');
  await expect(auditCard).toBeVisible();
  await auditCard.getByLabel(/操作者|Actor/i).fill(adminEmail);
  await auditCard.getByLabel(/配置键|Setting Key/i).selectOption(targetKey);
  await auditCard.getByTestId('settings-audit-apply-filters').click();

  const auditRows = auditCard.getByTestId('settings-audit-log-table').locator('tbody tr');
  await expect(auditRows).toHaveCount(20);
  await expect(auditCard.getByTestId('settings-audit-load-more')).toBeEnabled();
  await auditCard.getByTestId('settings-audit-load-more').click();
  await expect(auditRows).toHaveCount(21);
  await expect(auditCard.getByTestId('settings-audit-load-more')).toBeDisabled();

  const downloadPromise = page.waitForEvent('download');
  await auditCard.getByTestId('settings-audit-export').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/settings-audit-.*\.csv/i);

  const exportHistoryTable = auditCard.getByTestId('settings-audit-export-history-table');
  await expect(exportHistoryTable.getByText(adminEmail).first()).toBeVisible();
  await expect(exportHistoryTable.getByText(targetKey).first()).toBeVisible();
});
