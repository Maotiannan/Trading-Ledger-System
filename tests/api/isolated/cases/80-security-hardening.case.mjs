export const name = 'security-hardening';

export default async function run(t) {
  const oversizedPayload = {
    action: 'login',
    email: 'oversized@example.com',
    password: 'x',
    filler: 'x'.repeat(300 * 1024),
  };
  const oversizedLogin = await t.request('POST', '/api/auth', {
    json: oversizedPayload,
    expectedStatus: 413,
  });
  t.assertEqual(oversizedLogin.data?.code, 'REQUEST_TOO_LARGE', 'oversized auth payload returns REQUEST_TOO_LARGE');

  const badEmail = `${t.unique('limit')}@example.com`;
  for (let index = 0; index < 20; index += 1) {
    await t.request('POST', '/api/auth', {
      json: {
        action: 'login',
        email: badEmail,
        password: 'wrong-password',
      },
      expectedStatus: 401,
    });
  }
  const loginRateLimited = await t.request('POST', '/api/auth', {
    json: {
      action: 'login',
      email: badEmail,
      password: 'wrong-password',
    },
    expectedStatus: 429,
  });
  t.assertEqual(loginRateLimited.data?.code, 'RATE_LIMITED', 'login rate limit returns RATE_LIMITED');

  await t.loginAdmin();

  const suffix = t.unique('security');
  const salesEmail = `${suffix}-sales@example.com`;
  const salesPassword = 'Sales@2026!';
  await t.createUser({
    email: salesEmail,
    password: salesPassword,
    role: 'SALES',
    name: `Security ${suffix}`,
  });
  await t.logout();
  await t.login(salesEmail, salesPassword);

  for (let index = 0; index < 20; index += 1) {
    await t.request('POST', '/api/receipt', {
      json: { action: 'recognize' },
      expectedStatus: 400,
    });
  }
  const uploadRateLimited = await t.request('POST', '/api/receipt', {
    json: { action: 'recognize' },
    expectedStatus: 429,
  });
  t.assertEqual(uploadRateLimited.data?.code, 'RATE_LIMITED', 'upload rate limit returns RATE_LIMITED');

  for (let index = 0; index < 20; index += 1) {
    await t.request('POST', '/api/deletion', {
      json: { action: 'noop' },
      expectedStatus: 400,
    });
  }
  const deletionRateLimited = await t.request('POST', '/api/deletion', {
    json: { action: 'noop' },
    expectedStatus: 429,
  });
  t.assertEqual(deletionRateLimited.data?.code, 'RATE_LIMITED', 'deletion rate limit returns RATE_LIMITED');

  await t.logout();
}
