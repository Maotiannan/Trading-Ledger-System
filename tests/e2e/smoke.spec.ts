import { expect, test } from '@playwright/test';

test('login page renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('收汇管理系统')).toBeVisible();
  await expect(page.getByText('请登录以继续')).toBeVisible();
  await expect(page.getByLabel('邮箱')).toBeVisible();
  await expect(page.getByLabel('密码')).toBeVisible();
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible();
});
