export const name = 'settings-and-report';

export default async function run(t) {
  await t.initAdmin();
  await t.loginAdmin();

  const settingsBefore = await t.request('GET', '/api/settings', { expectedStatus: 200 });
  t.assertEqual(Boolean(settingsBefore.data?.data?.canEdit), true, 'admin can edit settings');
  t.assertEqual(Boolean(settingsBefore.data?.data?.canPurgeBranch), true, 'admin can purge branch data');

  const nextTolerance = '7';
  const nextSwiftWarningTolerance = '6';
  const nextSwiftRejectTolerance = '60';
  const currentSettings = settingsBefore.data?.data?.settings || {};
  const saveSettings = await t.request('POST', '/api/settings', {
    json: {
      action: 'update-config',
      settings: {
        ...currentSettings,
        DETAIL_RECEIPT_MATCH_TOLERANCE: nextTolerance,
        SWIFT_WARNING_TOLERANCE: nextSwiftWarningTolerance,
        SWIFT_REJECT_TOLERANCE: nextSwiftRejectTolerance,
      },
    },
    expectedStatus: 200,
  });
  t.assertEqual(Boolean(saveSettings.data?.success), true, 'settings update succeeds');

  const settingsAfter = await t.request('GET', '/api/settings', { expectedStatus: 200 });
  t.assertEqual(String(settingsAfter.data?.data?.settings?.DETAIL_RECEIPT_MATCH_TOLERANCE || ''), nextTolerance, 'updated tolerance persisted');
  t.assertEqual(String(settingsAfter.data?.data?.settings?.SWIFT_WARNING_TOLERANCE || ''), nextSwiftWarningTolerance, 'updated swift warning tolerance persisted');
  t.assertEqual(String(settingsAfter.data?.data?.settings?.SWIFT_REJECT_TOLERANCE || ''), nextSwiftRejectTolerance, 'updated swift reject tolerance persisted');

  const ocrTest = await t.request('POST', '/api/settings', {
    json: { action: 'test-ocr' },
    expectedStatus: 400,
  });
  t.assertMatch(ocrTest.data?.error || ocrTest.text, /OCR_DISABLED|禁用OCR/, 'OCR config test reports disabled OCR state in isolated env');

  await t.request('GET', '/api/report?format=excel', { expectedStatus: 200 });
  t.step('excel report export works');
  await t.request('GET', '/api/report?format=pdf', { expectedStatus: 200 });
  t.step('pdf report export works');

  await t.logout();
}
