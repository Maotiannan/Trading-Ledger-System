import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

export const name = 'mu-contract-order-sync';

const sourceBaseUrl = process.env.MU_CONTRACT_SYNC_BASE_URL;
const sourceControlToken = process.env.MU_CONTRACT_FAKE_CONTROL_TOKEN;

async function sourceControl(pathname, options = {}) {
  const response = await fetch(new URL(pathname, sourceBaseUrl), {
    method: options.method || 'GET',
    headers: {
      'x-control-token': sourceControlToken,
      ...(options.json ? { 'content-type': 'application/json' } : {}),
    },
    body: options.json ? JSON.stringify(options.json) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Fake source control failed: ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

function snapshotItem(piId, orderNo) {
  return {
    source: { system: 'MU_CONTRACT', piId, version: 1 },
    order: {
      orderNo,
      previousOrderNo: null,
      piCreatedAt: '2026-07-01T09:00:00.000Z',
      active: true,
      deletedAt: null,
    },
    officialAmount: null,
  };
}

function linkedEvent(cursor, piId, orderNo) {
  return {
    cursor: String(cursor),
    eventId: randomUUID(),
    eventType: 'PI_ORDER_LINKED',
    reason: 'ORDER_ASSIGNED',
    occurredAt: `2026-07-18T10:00:${String(cursor).padStart(2, '0')}.000Z`,
    ...snapshotItem(piId, orderNo),
  };
}

async function financialCounts(prisma) {
  const [invoices, orders, receipts, details, swifts] = await Promise.all([
    prisma.invoice.count(),
    prisma.order.count(),
    prisma.receipt.count(),
    prisma.detail.count(),
    prisma.swift.count(),
  ]);
  return { invoices, orders, receipts, details, swifts };
}

export default async function run(t) {
  const prisma = new PrismaClient();
  try {
    await sourceControl('/__control/reset', { method: 'POST' });
    await t.initAdmin();
    const login = await t.loginAdmin();
    const adminId = String(login.data?.data?.id || '');
    t.assertOk(Boolean(adminId), 'admin identity available for isolated integration fixtures');

    const suffix = t.unique('mucontract').replaceAll('-', '').slice(-12).toUpperCase();
    const orderName = `SYNC${suffix}`;
    const sourceOrderNos = Array.from({ length: 53 }, (_, index) => (
      `${orderName}-${String(index + 1).padStart(3, '0')}`
    ));
    const manualOnlyOrderNos = Array.from({ length: 10 }, (_, index) => (
      `LOCAL${suffix}-${String(index + 1).padStart(3, '0')}`
    ));

    const customerResponse = await t.request('POST', '/api/customer', {
      json: {
        action: 'create',
        mark: orderName,
        orderName,
        name: `MU Contract Sync Customer ${suffix}`,
        phone: `625${Math.floor(Math.random() * 900000 + 100000)}`,
        city: 'Conakry',
      },
      expectedStatus: 200,
    });
    const customer = customerResponse.data?.data;
    const customerId = String(customer?.id || '');
    t.assertOk(Boolean(customerId), 'integration fixture customer created');

    const trackerRows = [...sourceOrderNos.slice(0, 39), ...manualOnlyOrderNos].map((orderNo) => ({
      id: randomUUID(),
      orderNo,
      normalizedOrderNo: orderNo.replace(/\s+/g, '').toLowerCase(),
      tokens: JSON.stringify([orderNo.toLowerCase()]),
      amount: 0,
      orderBalance: 0,
      financeOrderId: null,
      createdBy: adminId,
      updatedBy: null,
      customerId,
      customerMark: customer.mark,
      customerName: customer.orderName,
      customerPhone: customer.phone,
      customerCity: customer.city,
      needsCustomerFix: false,
      status: 'In progress',
      confirmedAt: null,
      piStatus: false,
      remark: null,
      systemNote: null,
    }));
    await prisma.orderTracker.createMany({ data: trackerRows });
    t.assertEqual(trackerRows.length, 49, '39 source matches and 10 MULEDGER-only Orders seeded');

    const snapshotItems = sourceOrderNos.map((orderNo, index) => (
      snapshotItem(`pi-${String(index + 1).padStart(3, '0')}`, orderNo)
    ));
    await sourceControl('/__control/configure', {
      method: 'POST',
      json: { items: snapshotItems, events: [], eventHighWatermark: '0' },
    });

    const countsBefore = await financialCounts(prisma);
    const settingsResponse = await t.request('GET', '/api/settings', { expectedStatus: 200 });
    const settings = settingsResponse.data?.data?.settings || {};
    await t.request('POST', '/api/settings', {
      json: {
        action: 'update-config',
        settings: { ...settings, MU_CONTRACT_SYNC_ENABLED: 'true' },
      },
      expectedStatus: 409,
    });
    t.step('initial enable is rejected before Full Reconcile');

    await t.request('POST', '/api/integrations/mu-contract/actions', {
      json: { action: 'sync-now' },
      expectedStatus: 409,
    });
    t.step('incremental event consumption is gated before Full Reconcile');

    const preview = await t.request('POST', '/api/integrations/mu-contract/actions', {
      json: { action: 'preview-reconcile' },
      expectedStatus: 200,
    });
    const previewData = preview.data?.data;
    t.assertEqual(previewData?.summary?.metadataOnly, 39, 'preview reports 39 metadata-only links');
    t.assertEqual(previewData?.summary?.creates, 14, 'preview reports 14 synchronized Orders creates');
    t.assertEqual(previewData?.summary?.manualOnlyUntouched, 10, 'preview leaves 10 manual-only Orders untouched');

    await t.request('POST', '/api/integrations/mu-contract/actions', {
      json: { action: 'apply-reconcile', previewId: previewData.previewId },
      expectedStatus: 200,
    });
    t.assertEqual(
      await prisma.externalOrderSourceLink.count({ where: { provider: 'MU_CONTRACT' } }),
      53,
      'Full Reconcile persists one stable PI source link per source row',
    );
    t.assertEqual(
      await prisma.orderTracker.count({ where: { archivedAt: null } }),
      63,
      'Full Reconcile creates only the 14 missing Orders rows',
    );

    await t.request('POST', '/api/settings', {
      json: {
        action: 'update-config',
        settings: {
          ...settings,
          MU_CONTRACT_SYNC_ENABLED: 'true',
          MU_CONTRACT_SYNC_INTERVAL_SECONDS: '10',
          MU_CONTRACT_SYNC_BATCH_SIZE: '100',
        },
      },
      expectedStatus: 200,
    });
    t.step('incremental synchronization can be enabled after Full Reconcile');

    const firstEvent = linkedEvent(1, 'pi-054', `${orderName}-054`);
    await sourceControl('/__control/configure', {
      method: 'POST',
      json: { items: snapshotItems, events: [firstEvent], eventHighWatermark: '1' },
    });
    const firstSync = await t.request('POST', '/api/integrations/mu-contract/actions', {
      json: { action: 'sync-now' },
      expectedStatus: 200,
    });
    t.assertEqual(firstSync.data?.data?.processed, 1, 'first incremental source event is applied');

    const duplicateSync = await t.request('POST', '/api/integrations/mu-contract/actions', {
      json: { action: 'sync-now' },
      expectedStatus: 200,
    });
    t.assertEqual(duplicateSync.data?.data?.processed, 0, 'duplicate replay after committed cursor is idempotent');
    t.assertEqual(
      await prisma.integrationEventReceipt.count({ where: { provider: 'MU_CONTRACT' } }),
      1,
      'duplicate replay does not add a second event receipt',
    );

    const secondEvent = linkedEvent(2, 'pi-055', `${orderName}-055`);
    await sourceControl('/__control/configure', {
      method: 'POST',
      json: { items: snapshotItems, events: [firstEvent, secondEvent], eventHighWatermark: '2' },
    });
    await t.request('POST', '/api/integrations/mu-contract/actions', {
      json: { action: 'sync-now' },
      expectedStatus: 200,
    });

    const status = await t.request('GET', '/api/integrations/mu-contract/status', {
      expectedStatus: 200,
    });
    t.assertEqual(status.data?.data?.committedCursor, '2', 'incremental synchronization resumes from cursor 1 and commits cursor 2');
    const sourceRequests = await sourceControl('/__control/requests');
    const eventRequests = sourceRequests.requests.filter((row) => row.pathname.endsWith('/order-events'));
    t.assertOk(
      eventRequests.some((row) => row.query.after === '1'),
      'source request history proves cursor resume uses after=1',
    );
    t.assertEqual(
      eventRequests.every((row) => row.authorizationPresent === true),
      true,
      'every source feed request carries the dedicated bearer credential',
    );

    const countsAfter = await financialCounts(prisma);
    t.assertEqual(
      JSON.stringify(countsAfter),
      JSON.stringify(countsBefore),
      'reconcile and incremental sync do not write financial tables',
    );

    const salesEmail = `${suffix.toLowerCase()}-sales@example.com`;
    await t.createUser({
      email: salesEmail,
      password: 'Sales@2026!',
      role: 'SALES',
      name: `Sales ${suffix}`,
      parentId: adminId,
    });
    await t.logout();
    await t.login(salesEmail, 'Sales@2026!');
    await t.request('GET', '/api/integrations/mu-contract/status', { expectedStatus: 403 });
    t.step('integration status remains ADMIN-only');
    await t.logout();
  } finally {
    await prisma.$disconnect();
  }
}
