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

  const auditList = await t.request('GET', '/api/settings?view=audit&limit=20', { expectedStatus: 200 });
  t.assertEqual(Array.isArray(auditList.data?.data?.items), true, 'settings audit list returns item array');
  t.assertEqual(Boolean(auditList.data?.data?.meta?.maxPageSize), true, 'settings audit list returns server paging meta');

  const filteredAuditList = await t.request(
    'GET',
    `/api/settings?view=audit&limit=20&actor=${encodeURIComponent(t.adminEmail)}&key=SWIFT_WARNING_TOLERANCE&dateFrom=2026-03-11&dateTo=2026-03-12`,
    { expectedStatus: 200 },
  );
  t.assertEqual(
    filteredAuditList.data?.data?.items?.some((item) => Array.isArray(item?.updatedKeys) && item.updatedKeys.includes('SWIFT_WARNING_TOLERANCE')),
    true,
    'filtered settings audit list can match updated key',
  );

  const auditExport = await t.request('GET', '/api/settings?view=audit&format=csv&exportLimit=20', { expectedStatus: 200 });
  t.assertEqual(auditExport.headers.get('x-export-row-count') !== null, true, 'settings audit csv export returns row count header');
  t.assertEqual(auditExport.headers.get('x-export-summary') !== null, true, 'settings audit csv export returns export summary header');
  t.assertEqual(auditExport.headers.get('x-export-limit-applied') !== null, true, 'settings audit csv export returns applied limit header');
  t.assertEqual(auditExport.headers.get('x-export-limit-max') !== null, true, 'settings audit csv export returns max limit header');

  const exportHistory = await t.request('GET', '/api/settings?view=audit-export-history&limit=20', { expectedStatus: 200 });
  t.assertEqual(Array.isArray(exportHistory.data?.data?.items), true, 'settings audit export history returns item array');
  t.assertEqual(Boolean(exportHistory.data?.data?.items?.length), true, 'settings audit export history records the latest export');
  t.assertEqual(
    String(exportHistory.data?.data?.items?.[0]?.actor?.email || ''),
    t.adminEmail,
    'settings audit export history keeps exporter identity',
  );
  const filteredExportHistory = await t.request(
    'GET',
    `/api/settings?view=audit-export-history&limit=20&actor=${encodeURIComponent(t.adminEmail)}&key=SWIFT_WARNING_TOLERANCE`,
    { expectedStatus: 200 },
  );
  t.assertEqual(
    filteredExportHistory.data?.data?.items?.some((item) => Array.isArray(item?.exportedKeys) && item.exportedKeys.includes('SWIFT_WARNING_TOLERANCE')),
    true,
    'settings audit export history can be filtered by key',
  );

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
