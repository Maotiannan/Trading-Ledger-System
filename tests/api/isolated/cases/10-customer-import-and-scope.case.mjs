import ExcelJS from 'exceljs';

export const name = 'customer-import-and-scope';

async function buildWorkbook(filePath, rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('customers');
  sheet.addRow(['MARK', 'ORDER_NAME', 'NAME', 'PHONE', 'CITY', 'CONSIGNEE', 'COMPANY_NAME', 'CREDIT', 'COMPANY_ADDRESS', 'SALES_EMAIL']);
  for (const row of rows) {
    sheet.addRow(row);
  }
  await workbook.xlsx.writeFile(filePath);
}

export default async function run(t) {
  await t.initAdmin();
  const login = await t.loginAdmin();
  const adminId = String(login.data?.data?.id || '');
  t.assertOk(Boolean(adminId), 'admin id available');

  const suffix = t.unique('customer');
  const salesEmail = `${suffix}-sales@example.com`;
  const sales = await t.request('POST', '/api/auth', {
    json: {
      action: 'create',
      email: salesEmail,
      password: 'Sales@2026!',
      role: 'SALES',
      name: `Sales ${suffix}`,
    },
    expectedStatus: 200,
  });
  const salesId = String(sales.data?.data?.id || '');
  t.assertOk(Boolean(salesId), 'sales account created');

  const ownerOptions = await t.request('GET', '/api/customer?action=owner-options', { expectedStatus: 200 });
  const ownerRows = Array.isArray(ownerOptions.data?.data) ? ownerOptions.data.data : [];
  t.assertOk(ownerRows.some((row) => row.id === salesId), 'owner options include newly created sales');

  const basePhone = `622${Math.floor(Math.random() * 900000 + 100000)}`;
  const adminOnlyOrderName = `ORDER-${suffix}-ADMIN`;
  const adminOnlyCustomer = await t.request('POST', '/api/customer', {
    json: {
      action: 'create',
      mark: `MK-${suffix}-ADMIN`,
      orderName: adminOnlyOrderName,
      name: `Admin Customer ${suffix}`,
      phone: `${basePhone}0`,
      city: 'Conakry',
      ownerId: adminId,
    },
    expectedStatus: 200,
  });
  t.assertOk(Boolean(adminOnlyCustomer.data?.data?.id), 'admin-owned customer create works');

  const salesOrderName = `ORDER-${suffix}-SALES`;
  const createCustomer = await t.request('POST', '/api/customer', {
    json: {
      action: 'create',
      mark: `MK-${suffix}`,
      orderName: salesOrderName,
      name: `Customer ${suffix}`,
      phone: basePhone,
      city: 'Conakry',
      ownerId: salesId,
    },
    expectedStatus: 200,
  });
  t.assertOk(Boolean(createCustomer.data?.data?.id), 'sales-owned customer create works');

  const duplicate = await t.request('POST', '/api/customer', {
    json: {
      action: 'create',
      mark: `MK-${suffix}-DUP`,
      orderName: `ORDER-${suffix}-DUP`,
      name: `Dup ${suffix}`,
      phone: basePhone,
      city: 'Conakry',
      ownerId: salesId,
    },
    expectedStatus: 400,
  });
  t.assertEqual(duplicate.data?.code, 'CUSTOMER_DUPLICATE', 'duplicate customer create returns CUSTOMER_DUPLICATE code');
  t.assertMatch(duplicate.data?.error || duplicate.text, /PHONE|MARK|NAME|Duplicate|重复/, 'duplicate customer is rejected with detail message');

  const workbookPath = t.writeTempFile(`customer-import-${suffix}.xlsx`, '');
  await buildWorkbook(workbookPath, [
    [`IMP-${suffix}`, salesOrderName, `Import ${suffix}`, basePhone, 'Conakry', '', '', 0, '', salesEmail],
    [`IMP-${suffix}-OK`, `ORDER-${suffix}-OK`, `Import OK ${suffix}`, `${basePhone}9`, 'Conakry', '', '', 0, '', salesEmail],
  ]);

  const importResponse = await t.request('POST', '/api/customer', {
    form: {
      action: 'import-excel',
      ownerId: salesId,
      file: {
        filePath: workbookPath,
        filename: 'customer-import.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    },
    expectedStatus: 200,
  });
  const rowResults = Array.isArray(importResponse.data?.rowResults) ? importResponse.data.rowResults : [];
  t.assertEqual(rowResults.length, 2, 'customer import returns per-row results');
  t.assertOk(rowResults.some((row) => row.status === 'FAILED'), 'customer import captures failed duplicate rows');
  t.assertOk(rowResults.some((row) => row.status === 'CREATED'), 'customer import creates valid rows');

  const failedRow = rowResults.find((row) => row.status === 'FAILED');
  t.assertOk(Boolean(failedRow), 'failed customer import row available for retry');

  const retry = await t.request('POST', '/api/customer', {
    json: {
      action: 'import-rows',
      ownerId: salesId,
      rows: [
        {
          rowNo: failedRow.rowNo,
          mark: failedRow.mark,
          orderName: `${failedRow.orderName}-FIX`,
          name: failedRow.name,
          phone: `${basePhone}7`,
          city: failedRow.city,
          consignee: failedRow.consignee,
          companyName: failedRow.companyName,
          credit: failedRow.credit,
          companyAddress: failedRow.companyAddress,
          ownerEmail: salesEmail,
        },
      ],
    },
    expectedStatus: 200,
  });
  const retryRows = Array.isArray(retry.data?.rowResults) ? retry.data.rowResults : [];
  t.assertEqual(retryRows[0]?.status, 'CREATED', 'customer issue row retry succeeds after correction');

  const missingTemplateColumnWorkbookPath = t.writeTempFile(`customer-import-missing-column-${suffix}.xlsx`, '');
  await buildWorkbook(missingTemplateColumnWorkbookPath, []);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(missingTemplateColumnWorkbookPath);
  const sheet = workbook.worksheets[0];
  sheet.getRow(1).values = ['MARK', 'ORDER_NAME', 'NAME'];
  await workbook.xlsx.writeFile(missingTemplateColumnWorkbookPath);
  const invalidTemplate = await t.request('POST', '/api/customer', {
    form: {
      action: 'import-excel',
      ownerId: salesId,
      file: {
        filePath: missingTemplateColumnWorkbookPath,
        filename: 'customer-invalid-template.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    },
    expectedStatus: 400,
  });
  t.assertEqual(invalidTemplate.data?.code, 'IMPORT_TEMPLATE_INVALID', 'customer import template validation returns IMPORT_TEMPLATE_INVALID code');

  await t.logout();
  await t.login(salesEmail, 'Sales@2026!');
  const scopedList = await t.request('GET', `/api/customer?search=${encodeURIComponent(`ORDER-${suffix}-OK`)}`, { expectedStatus: 200 });
  const scopedRows = Array.isArray(scopedList.data?.data) ? scopedList.data.data : [];
  t.assertOk(scopedRows.length >= 1, 'sales can see branch-bound imported customer');

  const blockedList = await t.request('GET', `/api/customer?search=${encodeURIComponent(adminOnlyOrderName)}`, { expectedStatus: 200 });
  const blockedRows = Array.isArray(blockedList.data?.data) ? blockedList.data.data : [];
  t.assertEqual(blockedRows.length, 0, 'sales cannot see admin-owned customer from another branch');

  await t.logout();
}
