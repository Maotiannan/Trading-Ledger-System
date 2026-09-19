import { expect, test } from '@playwright/test';
import { ensureAdminInitialized, loginAsAdmin } from './helpers/session';
for (const width of [1280, 390]) {
  test('WhatsApp admin page fits viewport ' + width, async ({ page, request }) => {
    await ensureAdminInitialized(request);
    await page.setViewportSize({ width, height: 850 });
    await loginAsAdmin(page);
    let cancelled = false;
    await page.route('**/api/whatsapp-notifications?*', route => route.fulfill({ json: { success: true, data: { total: 1, items: [{
      id: 'isolated-buffer-preview', type: 'PAYMENT_RECEIVED', status: cancelled ? 'CANCELLED' : 'QUEUED',
      testMode: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      nextSendAt: new Date(Date.now() + 300000).toISOString(), actualTo: '+10000000001',
      templateName: 'muledger_payment_v1', languageCode: 'en', parameters: [], businessSnapshot: {}, failureCode: null,
    }] } } }));
    await page.route('**/api/whatsapp-notifications', async route => {
      expect(route.request().postDataJSON()).toEqual({ action: 'cancel', ids: ['isolated-buffer-preview'] });
      cancelled = true;
      await route.fulfill({ json: { success: true, data: { cancelled: 1 } } });
    });
    await page.goto('/whatsapp');
    await expect(page.getByRole('heading', { name: /WhatsApp 通知|WhatsApp Notifications/ })).toBeVisible();
    await expect(page.getByLabel(/启用发送|Enable sending/)).not.toBeChecked();
    await expect(page.getByLabel(/客户已明确同意|Customer explicitly agreed/)).not.toBeChecked();
    await expect(page.getByText('muledger_payment_v1 · en')).toBeVisible();
    await expect(page).toHaveURL(/notifications\?channel=whatsapp/);
    await expect(page.getByRole('columnheader', { name: /预计发送|Scheduled/ })).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: /^(取消|Cancel)$/ }).click();
    await expect(page.getByRole('button', { name: /^(取消|Cancel)$/ })).toHaveCount(0);
    await page.getByLabel(/正文|Body/, { exact: true }).fill('Invalid missing variables');
    await expect(page.getByRole('button', {name: /保存为新草稿|Save as new draft/})).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
}
