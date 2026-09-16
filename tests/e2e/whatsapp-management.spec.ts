import { expect, test } from '@playwright/test';
import { ensureAdminInitialized, loginAsAdmin } from './helpers/session';
for (const width of [1280, 390]) {
  test('WhatsApp admin page fits viewport ' + width, async ({ page, request }) => {
    await ensureAdminInitialized(request);
    await page.setViewportSize({ width, height: 850 });
    await loginAsAdmin(page);
    await page.goto('/whatsapp');
    await expect(page.getByRole('heading', { name: /WhatsApp 通知|WhatsApp Notifications/ })).toBeVisible();
    await expect(page.getByLabel(/启用发送|Enable sending/)).not.toBeChecked();
    await expect(page.getByLabel(/客户已明确同意|Customer explicitly agreed/)).not.toBeChecked();
    await expect(page.getByText('muledger_payment_v1 · en')).toBeVisible();
    await expect(page).toHaveURL(/notifications\?channel=whatsapp/);
    await page.getByLabel(/正文|Body/, { exact: true }).fill('Invalid missing variables');
    await expect(page.getByRole('button', {name: /保存为新草稿|Save as new draft/})).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
}
