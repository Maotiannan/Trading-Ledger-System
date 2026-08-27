export const name = 'auth-system';

export default async function run(t) {
  const unauthedHealth = await t.request('GET', '/api/system/health', { expectedStatus: 401 });
  t.assertEqual(unauthedHealth.data?.code, 'AUTH_REQUIRED', 'system health unauthenticated response returns AUTH_REQUIRED code');
  t.step('system health requires auth');

  const badLogin = await t.request('POST', '/api/auth', {
    json: { action: 'login', email: t.adminEmail, password: 'wrong-password' },
    expectedStatus: 401,
  });
  t.assertEqual(badLogin.data?.code, 'INVALID_CREDENTIALS', 'invalid login returns INVALID_CREDENTIALS code');

  await t.initAdmin();
  const login = await t.loginAdmin();
  t.assertEqual(login.data?.data?.email, t.adminEmail, 'admin login returns expected account');

  const me = await t.request('POST', '/api/auth', {
    json: { action: 'me' },
    expectedStatus: 200,
  });
  t.assertEqual(me.data?.data?.email, t.adminEmail, 'auth me returns current admin');

  const health = await t.request('GET', '/api/system/health', { expectedStatus: 200 });
  t.assertMatch(health.data?.data?.serverDate || '', /^\d{4}-\d{2}-\d{2}/, 'system health returns server date');

  await t.request('GET', '/api/system/routes', { expectedStatus: 200 });
  t.step('system routes accessible after login');

  await t.request('POST', '/api/locale', {
    json: { locale: 'en' },
    expectedStatus: 200,
  });
  t.step('locale update works');

  const invalidAction = await t.request('POST', '/api/auth', {
    json: { action: 'nope' },
    expectedStatus: 400,
  });
  t.assertEqual(invalidAction.data?.code, 'INVALID_ACTION', 'unknown auth action returns INVALID_ACTION code');

  await t.request('POST', '/api/locale', {
    json: { locale: 'zh' },
    expectedStatus: 200,
  });
  t.step('locale restored for isolated case independence');

  await t.logout();
}
