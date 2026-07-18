import { createHash, randomUUID } from 'node:crypto';

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

function renamedEvent(cursor, piId, version, previousOrderNo, orderNo) {
  return {
    cursor: String(cursor),
    eventId: randomUUID(),
    eventType: 'PI_ORDER_RENAMED',
    reason: 'ORDER_CHANGED',
    occurredAt: `2026-07-18T10:00:${String(cursor).padStart(2, '0')}.000Z`,
    ...snapshotItem(piId, orderNo),
    source: { system: 'MU_CONTRACT', piId, version },
    order: {
      ...snapshotItem(piId, orderNo).order,
      previousOrderNo,
    },
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value.toISOString();
    if (Buffer.isBuffer(value)) return value.toString('base64');
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]));
  }
  return value;
}

async function financialChecksums(prisma) {
  const tables = await Promise.all([
    ['invoices', prisma.invoice.findMany({ orderBy: { id: 'asc' } })],
    ['orders', prisma.order.findMany({ orderBy: { id: 'asc' } })],
    ['receipts', prisma.receipt.findMany({ orderBy: { id: 'asc' } })],
    ['details', prisma.detail.findMany({ orderBy: { id: 'asc' } })],
    ['swifts', prisma.swift.findMany({ orderBy: { id: 'asc' } })],
  ]);
  return Object.fromEntries(tables.map(([name, rows]) => {
    const content = JSON.stringify(canonicalize(rows));
    return [name, {
      rows: rows.length,
      sha256: createHash('sha256').update(content).digest('hex'),
    }];
  }));
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

    const [activeTrackerCountBefore, manualOnlyCountBefore] = await Promise.all([
      prisma.orderTracker.count({ where: { archivedAt: null } }),
      prisma.orderTracker.count({
        where: {
          archivedAt: null,
          externalSourceLinks: { none: { provider: 'MU_CONTRACT' } },
        },
      }),
    ]);

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

    const financialBefore = await financialChecksums(prisma);
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
    t.assertEqual(
      previewData?.summary?.manualOnlyUntouched,
      manualOnlyCountBefore + manualOnlyOrderNos.length,
      'preview leaves all existing and 10 newly seeded manual-only Orders untouched',
    );

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
      activeTrackerCountBefore + trackerRows.length + 14,
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

    const invalidEvent = {
      ...linkedEvent(3, 'pi-056', `${orderName}-056`),
      officialAmount: {
        currency: 'USD',
        value: 'sensitive-invalid-amount',
        generatedAt: '2026-07-18T10:00:03.000Z',
        generationRunId: 'invalid-run',
      },
    };
    const laterValidEvent = linkedEvent(4, 'pi-057', `${orderName}-057`);
    await sourceControl('/__control/configure', {
      method: 'POST',
      json: {
        items: snapshotItems,
        events: [firstEvent, secondEvent, invalidEvent, laterValidEvent],
        eventHighWatermark: '4',
      },
    });
    const invalidThenValid = await t.request('POST', '/api/integrations/mu-contract/actions', {
      json: { action: 'sync-now' },
      expectedStatus: 200,
    });
    t.assertEqual(invalidThenValid.data?.data?.processed, 2, 'invalid event does not block the later valid event');
    t.assertEqual(invalidThenValid.data?.data?.conflicts, 1, 'identifiable invalid event is reported as one business conflict');
    const invalidReceipt = await prisma.integrationEventReceipt.findUnique({
      where: { provider_eventId: { provider: 'MU_CONTRACT', eventId: invalidEvent.eventId } },
    });
    t.assertEqual(invalidReceipt?.result, 'BUSINESS_CONFLICT', 'invalid event receipt is durable');
    const invalidConflict = await prisma.integrationSyncConflict.findUnique({
      where: { dedupeKey: 'MU_CONTRACT:pi-056:INVALID_SOURCE_DATA' },
    });
    t.assertEqual(invalidConflict?.type, 'INVALID_SOURCE_DATA', 'invalid source data conflict is opened');
    t.assertOk(
      !JSON.stringify(invalidConflict).includes('sensitive-invalid-amount'),
      'invalid source conflict stores no raw business payload or secret',
    );

    const unresolvedEvent = linkedEvent(5, 'pi-058', `UNMATCHED${suffix}-001`);
    await sourceControl('/__control/configure', {
      method: 'POST',
      json: {
        items: snapshotItems,
        events: [firstEvent, secondEvent, invalidEvent, laterValidEvent, unresolvedEvent],
        eventHighWatermark: '5',
      },
    });
    await t.request('POST', '/api/integrations/mu-contract/actions', {
      json: { action: 'sync-now' },
      expectedStatus: 200,
    });
    const unresolvedLink = await prisma.externalOrderSourceLink.findUnique({
      where: { provider_externalId: { provider: 'MU_CONTRACT', externalId: 'pi-058' } },
    });
    t.assertEqual(unresolvedLink?.customerMatchStatus, 'UNMATCHED', 'unmatched synchronized Order is available for ADMIN resolution');
    await t.request('POST', '/api/orders', {
      json: {
        action: 'resolve-source-customer',
        orderId: unresolvedLink.orderTrackerId,
        customerId,
      },
      expectedStatus: 200,
    });
    const resolvedTracker = await prisma.orderTracker.findUnique({ where: { id: unresolvedLink.orderTrackerId } });
    const resolvedLink = await prisma.externalOrderSourceLink.findUnique({
      where: { provider_externalId: { provider: 'MU_CONTRACT', externalId: 'pi-058' } },
    });
    t.assertEqual(resolvedTracker?.customerId, customerId, 'ADMIN resolution updates the Orders customer snapshot');
    t.assertEqual(resolvedTracker?.needsCustomerFix, false, 'ADMIN resolution clears the customer-fix flag');
    t.assertEqual(resolvedLink?.customerMatchStatus, 'MATCHED', 'ADMIN resolution closes the source customer status');

    const renamedOrderNo = `${orderName}-RENAMED`;
    const renamedSourceItem = {
      ...snapshotItems[0],
      source: { ...snapshotItems[0].source, version: 2 },
      order: { ...snapshotItems[0].order, orderNo: renamedOrderNo },
    };
    const manualLinkBeforeRename = await prisma.externalOrderSourceLink.findUnique({
      where: { provider_externalId: { provider: 'MU_CONTRACT', externalId: 'pi-001' } },
      include: { orderTracker: true },
    });
    const manualTrackerBeforeRename = manualLinkBeforeRename?.orderTracker;
    t.assertEqual(manualLinkBeforeRename?.linkMode, 'MANUAL_ATTACHED', 'rename fixture starts from a manually created Orders row');
    const rename = renamedEvent(6, 'pi-001', 2, sourceOrderNos[0], renamedOrderNo);
    await sourceControl('/__control/configure', {
      method: 'POST',
      json: {
        items: [renamedSourceItem, ...snapshotItems.slice(1)],
        events: [firstEvent, secondEvent, invalidEvent, laterValidEvent, unresolvedEvent, rename],
        eventHighWatermark: '6',
      },
    });
    const renameSync = await t.request('POST', '/api/integrations/mu-contract/actions', {
      json: { action: 'sync-now' },
      expectedStatus: 200,
    });
    t.assertEqual(renameSync.data?.data?.processed, 1, 'same PI rename is consumed through the synchronization API');
    const manualLinkAfterRename = await prisma.externalOrderSourceLink.findUnique({
      where: { provider_externalId: { provider: 'MU_CONTRACT', externalId: 'pi-001' } },
      include: { orderTracker: true },
    });
    t.assertEqual(manualLinkAfterRename?.orderTrackerId, manualLinkBeforeRename?.orderTrackerId, 'same PI rename preserves the linked Orders row identity');
    t.assertEqual(manualLinkAfterRename?.orderTracker?.orderNo, renamedOrderNo, 'same PI rename updates the manually linked ORDER NO');
    t.assertEqual(manualLinkAfterRename?.orderTracker?.customerId, manualTrackerBeforeRename?.customerId, 'same PI rename preserves the manually linked customer');
    t.assertEqual(manualLinkAfterRename?.orderTracker?.status, manualTrackerBeforeRename?.status, 'same PI rename preserves the manually maintained status');
    t.assertEqual(manualLinkAfterRename?.orderTracker?.remark, manualTrackerBeforeRename?.remark, 'same PI rename preserves the manually maintained remark');

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

    const financialAfter = await financialChecksums(prisma);
    t.assertEqual(
      JSON.stringify(financialAfter),
      JSON.stringify(financialBefore),
      'reconcile, incremental sync, and customer resolution preserve every financial row checksum',
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
