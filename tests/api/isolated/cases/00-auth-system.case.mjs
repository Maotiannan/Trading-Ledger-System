export const name = 'auth-system';

export default async function run(t) {
  await t.request('GET', '/api/system/health', { expectedStatus: 401 });
  t.step('system health requires auth');

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

  await t.logout();
}
