import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { DEFAULT_DASHBOARD_LAYOUT } from '../../src/lib/dashboard-layout-preference';

test.skip(process.env.MULEDGER_RELIABILITY_UI !== 'true', 'Opt-in isolated reliability browser suite');
const db = new PrismaClient();
const password = 'ReliabilityUi@2026';
const users: Array<{ id: string; email: string }> = [];
test.beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL || '');
  const base = new URL(process.env.PLAYWRIGHT_BASE_URL || '');
  if (url.hostname !== '127.0.0.1' || !['/muledger_reliability_test', '/trading_ledger_test'].includes(url.pathname)
    || base.hostname !== '127.0.0.1' || !['56632', '3200'].includes(base.port)
    || process.env.PLAYWRIGHT_SKIP_WEBSERVER !== '1') throw new Error('Requires isolated DB and explicit reliability dev server');
  for (let i = 0; i < 2; i += 1) {
    const user = await db.user.create({ data: { email: `ui-${Date.now()}-${i}@example.invalid`, name: `Isolated UI ${i}`,
      password: await bcrypt.hash(password, 12), role: 'ADMIN', level: 1 } });
    users.push(user);
    const layout = structuredClone(DEFAULT_DASHBOARD_LAYOUT);
    layout.sections[0].cards.sort((a, b) => Number(b.id === (i === 0 ? 'pending-receipts' : 'waiting-swift')) - Number(a.id === (i === 0 ? 'pending-receipts' : 'waiting-swift')));
    for (const section of layout.sections.slice(1)) section.visible = false;
    await db.userPreference.create({ data: { userId: user.id, dashboardLayout: layout } });
  }
});
test.afterAll(async () => { await db.$disconnect(); });

const firstLabel = (page: Page) => page.locator('main [data-slot="card-description"]').first();
async function login(page: Page, index = 0) {
  await page.goto('/');
  await page.getByRole('textbox', { name: /邮箱|Email/ }).fill(users[index].email);
  await page.getByRole('textbox', { name: /密码|Password/ }).fill(password);
  await page.getByRole('button', { name: /^登录$|^Log in$|^Login$/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}
async function watchFirstFrames(page: Page) {
  await page.addInitScript(() => {
    const frames: string[] = [];
    Object.assign(window, { reliabilityFirstFrames: frames });
    new MutationObserver(() => {
      const first = document.querySelector('main [data-slot="card-description"]')?.textContent || '';
      if (first && frames.at(-1) !== first) frames.push(first);
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
}
async function expectOnlyFrames(page: Page, pattern: RegExp) {
  const frames = await page.evaluate(() => (window as unknown as { reliabilityFirstFrames: string[] }).reliabilityFirstFrames);
  expect(frames.length).toBeGreaterThan(0);
  for (const frame of frames) expect(frame).toMatch(pattern);
}

test('slow identity lookup never paints default layout before the personal layout; accounts remain isolated', async ({ page }) => {
  await watchFirstFrames(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  await expect(firstLabel(page)).toHaveText(/待处理收据|Pending Receipts/);
  await page.route('**/api/auth', async (route) => {
    if (route.request().postDataJSON()?.action === 'me') await new Promise((resolve) => setTimeout(resolve, 650));
    await route.continue();
  });
  await page.reload();
  await expect(firstLabel(page)).toHaveText(/待处理收据|Pending Receipts/);
  await expectOnlyFrames(page, /待处理收据|Pending Receipts/);
  await page.getByRole('button', { name: /退出登录|Log out/i }).click();
  await login(page, 1);
  await expect(firstLabel(page)).toHaveText(/等待SWIFT|Waiting SWIFT/);
  await page.reload();
  await expect(firstLabel(page)).toHaveText(/等待SWIFT|Waiting SWIFT/);
  await expectOnlyFrames(page, /等待SWIFT|Waiting SWIFT/);
  expect(errors).toEqual([]);
  await page.screenshot({ path: '/tmp/muledger-reliability-dashboard-desktop.png', fullPage: true });
});

test('failed preference read shows retry rather than defaults, then loads the saved layout on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/auth', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (body.data) delete body.data.preferences;
    await route.fulfill({ response, json: body });
  });
  let failRead = true;
  await page.route('**/api/settings?view=user-preferences', async (route) => {
    if (failRead) await route.fulfill({ status: 503, json: { success: false, message: 'isolated injected failure' } });
    else await route.continue();
  });
  await login(page);
  const placeholder = page.getByTestId('dashboard-layout-placeholder');
  await expect(placeholder).toBeVisible();
  await expect(page.locator('main [data-slot="card-description"]')).toHaveCount(0);
  failRead = false;
  await page.getByRole('button', { name: /重试加载布局|Retry loading layout/ }).click();
  await expect(firstLabel(page)).toHaveText(/待处理收据|Pending Receipts/);
  await expect(placeholder).not.toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.getByRole('button', { name: /收起侧边栏|Collapse sidebar/i }).click();
  await expect(firstLabel(page)).toHaveText(/待处理收据|Pending Receipts/);
  await page.screenshot({ path: '/tmp/muledger-reliability-dashboard-mobile.png', fullPage: true });
});

test('saving layout updates the same-account cache and recovery settings are usable', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /^设置$|^Settings$/ }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole('button', { name: /^Dashboard 设置$|^Dashboard Settings$/ }).click();
  const card = page.locator('[data-slot="card"]').filter({ has: page.locator('[data-slot="card-title"]').filter({ hasText: /Dashboard 设置|Dashboard Settings/ }) });
  await card.getByRole('button', { name: /Move (账单余额|Invoice Balance) up/ }).click();
  const saved = page.waitForResponse((response) => response.url().endsWith('/api/settings') && response.request().method() === 'POST');
  await card.getByRole('button', { name: /保存个人偏好|Save Personal Preferences/ }).click();
  expect((await saved).ok()).toBe(true);
  await page.getByRole('button', { name: /^恢复区$|^Recovery Area$/ }).click();
  await page.getByRole('button', { name: /刷新恢复区|Refresh recovery area/ }).click();
  await expect(page.getByText(/暂无可恢复记录|No recoverable records/)).toBeVisible();
  await page.getByRole('button', { name: /^仪表盘$|^Dashboard$/ }).click();
  await expect(firstLabel(page)).toHaveText(/账单总数|Invoice Balance/);
  await page.reload();
  await expect(firstLabel(page)).toHaveText(/账单总数|Invoice Balance/);
});
