import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { MuContractClient } from '@/lib/integrations/mu-contract-client';
import { applyMuContractOrderState } from '@/lib/integrations/mu-contract-order-applier';
import { resolveMuContractOrderCustomer } from '@/lib/integrations/mu-contract-customer-resolver';
import type {
  MuContractSnapshotItem,
  MuContractSnapshotPage,
} from '@/lib/integrations/mu-contract-contract';
import {
  applyMuContractReconcile,
  previewMuContractReconcile,
} from '@/lib/integrations/mu-contract-reconcile-service';
import { getMuContractSyncSettings } from '@/lib/integrations/mu-contract-sync-settings';

jest.mock('@/lib/integrations/mu-contract-order-applier', () => ({
  applyMuContractOrderState: jest.fn(),
}));

jest.mock('@/lib/integrations/mu-contract-customer-resolver', () => ({
  resolveMuContractOrderCustomer: jest.fn(),
}));

jest.mock('@/lib/integrations/mu-contract-sync-settings', () => ({
  getMuContractSyncSettings: jest.fn(),
}));

const mockApply = applyMuContractOrderState as jest.Mock;
const mockResolveCustomer = resolveMuContractOrderCustomer as jest.Mock;
const mockGetSettings = getMuContractSyncSettings as jest.Mock;

function snapshotFixture(): MuContractSnapshotPage {
  return JSON.parse(readFileSync(
    path.join(process.cwd(), 'tests/fixtures/mu-contract-order-sync/deactivated.json'),
    'utf8',
  ));
}

function activeItem(piId: string, orderNo: string): MuContractSnapshotItem {
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

function previewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'preview-1',
    provider: 'MU_CONTRACT',
    sourceHighWatermark: '1042',
    snapshotSummary: {
      totalSourceRows: 1,
      metadataOnly: 0,
      creates: 1,
      updates: 0,
      inactive: 1,
      unmatched: 1,
      conflicts: 0,
      manualOnlyUntouched: 0,
    },
    summaryHash: 'summary-hash',
    createdBy: 'admin-1',
    createdAt: new Date('2026-07-18T09:00:00.000Z'),
    expiresAt: new Date('2026-07-18T09:15:00.000Z'),
    consumedAt: null,
    ...overrides,
  };
}

function syncState(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'MU_CONTRACT',
    committedCursor: null,
    initialReconcileCompletedAt: null,
    reconcileStatus: 'IDLE',
    reconcileCursor: null,
    reconcileHighWatermark: null,
    serviceActorId: 'admin-1',
    leaseOwner: null,
    leaseExpiresAt: null,
    ...overrides,
  };
}

function makeClient(page = snapshotFixture()) {
  return {
    fetchEvents: jest.fn(),
    fetchSnapshot: jest.fn().mockResolvedValue(page),
    fetchSnapshotHighWatermark: jest.fn().mockResolvedValue(page.eventHighWatermark),
  } as unknown as jest.Mocked<MuContractClient>;
}

function makeDb(options: {
  preview?: ReturnType<typeof previewRow> | null;
  state?: ReturnType<typeof syncState>;
} = {}) {
  const currentState = options.state ?? syncState();
  const tx = {
    integrationSyncState: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(async ({ data }) => ({ ...currentState, ...data })),
    },
    integrationReconcilePreview: {
      update: jest.fn(async ({ data }) => ({ ...previewRow(), ...data })),
    },
  };
  const root = {
    externalOrderSourceLink: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    orderTracker: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    integrationReconcilePreview: {
      create: jest.fn(async ({ data }) => ({ id: 'preview-1', ...data })),
      findUnique: jest.fn().mockResolvedValue(
        options.preview === undefined ? previewRow() : options.preview,
      ),
    },
    integrationSyncState: {
      findUnique: jest.fn().mockResolvedValue(currentState),
      upsert: jest.fn().mockResolvedValue(currentState),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(async ({ data }) => ({ ...currentState, ...data })),
    },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  return { root, tx };
}

async function persistPreview(
  root: ReturnType<typeof makeDb>['root'],
  client: jest.Mocked<MuContractClient>,
) {
  const result = await previewMuContractReconcile('admin-1', {
    client,
    dbClient: root,
    now: () => fixedNow,
  });
  const data = root.integrationReconcilePreview.create.mock.calls.at(-1)?.[0].data;
  root.integrationReconcilePreview.findUnique.mockResolvedValue({
    id: result.previewId,
    ...data,
    consumedAt: null,
  });
  return result;
}

const fixedNow = new Date('2026-07-18T09:05:00.000Z');

describe('MU Contract Full Reconcile', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockGetSettings.mockResolvedValue({ enabled: false, intervalSeconds: 30, batchSize: 100 });
    mockApply.mockResolvedValue({
      result: 'APPLIED',
      orderTrackerId: 'tracker-1',
      linkMode: 'SYNC_CREATED',
      conflictType: null,
    });
    mockResolveCustomer.mockResolvedValue({
      status: 'UNMATCHED',
      orderNo: 'AB-12',
      code: 'EXCEL_ORDER_NOT_FOUND',
      message: '订单未匹配到客户',
    });
  });

  it('stores a 15-minute read-only preview with source and manual-only counts', async () => {
    const { root } = makeDb();
    root.orderTracker.findMany.mockResolvedValueOnce([{
      id: 'manual-only',
      normalizedOrderNo: 'manual-01',
      externalSourceLinks: [],
    }]);
    const client = makeClient();

    const result = await previewMuContractReconcile('admin-1', {
      client,
      dbClient: root,
      now: () => fixedNow,
    });

    expect(result).toEqual(expect.objectContaining({
      previewId: 'preview-1',
      highWatermark: '1042',
      summary: expect.objectContaining({
        totalSourceRows: 1,
        creates: 1,
        inactive: 1,
        manualOnlyUntouched: 1,
      }),
    }));
    expect(root.integrationReconcilePreview.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'MU_CONTRACT',
        createdBy: 'admin-1',
        sourceHighWatermark: '1042',
        expiresAt: new Date('2026-07-18T09:20:00.000Z'),
      }),
    });
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('rejects an expired preview before contacting the source', async () => {
    const { root } = makeDb({
      preview: previewRow({ expiresAt: new Date('2026-07-18T09:04:59.000Z') }),
    });
    const client = makeClient();

    await expect(applyMuContractReconcile('admin-1', 'preview-1', {
      client,
      dbClient: root,
      now: () => fixedNow,
      leaseOwner: 'lease-1',
    })).rejects.toMatchObject({ code: 'MU_CONTRACT_RECONCILE_PREVIEW_EXPIRED' });

    expect(client.fetchSnapshotHighWatermark).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('rejects source high-watermark drift and requires a new preview', async () => {
    const { root } = makeDb();
    const client = makeClient();
    await persistPreview(root, client);
    client.fetchSnapshot.mockResolvedValueOnce({
      ...snapshotFixture(),
      eventHighWatermark: '1043',
    });

    await expect(applyMuContractReconcile('admin-1', 'preview-1', {
      client,
      dbClient: root,
      now: () => fixedNow,
      leaseOwner: 'lease-1',
    })).rejects.toMatchObject({ code: 'MU_CONTRACT_RECONCILE_SOURCE_CHANGED' });

    expect(mockApply).not.toHaveBeenCalled();
  });

  it('rejects a snapshot whose high-watermark changes between pages', async () => {
    const firstPage: MuContractSnapshotPage = {
      schemaVersion: 1,
      items: [activeItem('pi-a', 'AB-11')],
      eventHighWatermark: '1042',
      nextAfter: 'pi-a',
      hasMore: true,
    };
    const secondPage: MuContractSnapshotPage = {
      schemaVersion: 1,
      items: [activeItem('pi-b', 'AB-12')],
      eventHighWatermark: '1043',
      nextAfter: null,
      hasMore: false,
    };
    const client = makeClient(firstPage);
    client.fetchSnapshot.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage);
    const { root } = makeDb();

    await expect(previewMuContractReconcile('admin-1', {
      client,
      dbClient: root,
      now: () => fixedNow,
    })).rejects.toMatchObject({ code: 'MU_CONTRACT_RECONCILE_SOURCE_CHANGED' });

    expect(root.integrationReconcilePreview.create).not.toHaveBeenCalled();
  });

  it('rejects same-high-watermark snapshot row drift before any writes', async () => {
    const changed = snapshotFixture();
    changed.items[0] = {
      ...changed.items[0],
      source: { ...changed.items[0].source, version: changed.items[0].source.version + 1 },
    };
    const client = makeClient();
    const { root } = makeDb();
    await persistPreview(root, client);
    client.fetchSnapshot.mockResolvedValueOnce(changed);

    await expect(applyMuContractReconcile('admin-1', 'preview-1', {
      client,
      dbClient: root,
      now: () => fixedNow,
      leaseOwner: 'lease-1',
    })).rejects.toMatchObject({ code: 'MU_CONTRACT_RECONCILE_SOURCE_CHANGED' });

    expect(mockApply).not.toHaveBeenCalled();
  });

  it('rejects same-high-watermark official amount drift before any writes', async () => {
    const client = makeClient();
    const { root } = makeDb();
    await persistPreview(root, client);
    const changed = snapshotFixture();
    changed.items[0] = {
      ...changed.items[0],
      officialAmount: {
        currency: 'USD',
        value: '999.99',
        generatedAt: '2026-07-18T08:00:00.000Z',
        generationRunId: 'changed-run',
      },
    };
    client.fetchSnapshot.mockResolvedValueOnce(changed);

    await expect(applyMuContractReconcile('admin-1', 'preview-1', {
      client,
      dbClient: root,
      now: () => fixedNow,
      leaseOwner: 'lease-1',
    })).rejects.toMatchObject({ code: 'MU_CONTRACT_RECONCILE_SOURCE_CHANGED' });

    expect(mockApply).not.toHaveBeenCalled();
  });

  it('rejects apply-time high-watermark drift between pages before writes', async () => {
    const firstPage: MuContractSnapshotPage = {
      schemaVersion: 1,
      items: [activeItem('pi-a', 'AB-11')],
      eventHighWatermark: '1042',
      nextAfter: 'pi-a',
      hasMore: true,
    };
    const finalPage: MuContractSnapshotPage = {
      schemaVersion: 1,
      items: [activeItem('pi-b', 'AB-12')],
      eventHighWatermark: '1042',
      nextAfter: null,
      hasMore: false,
    };
    const client = makeClient(firstPage);
    client.fetchSnapshot.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(finalPage);
    const { root } = makeDb();
    await persistPreview(root, client);
    client.fetchSnapshot.mockResolvedValueOnce(firstPage).mockResolvedValueOnce({
      ...finalPage,
      eventHighWatermark: '1043',
    });

    await expect(applyMuContractReconcile('admin-1', 'preview-1', {
      client,
      dbClient: root,
      now: () => fixedNow,
      leaseOwner: 'lease-1',
    })).rejects.toMatchObject({ code: 'MU_CONTRACT_RECONCILE_SOURCE_CHANGED' });

    expect(mockApply).not.toHaveBeenCalled();
  });

  it('rejects local target-state drift before any writes', async () => {
    const { root } = makeDb();
    const client = makeClient();
    await persistPreview(root, client);
    root.orderTracker.findMany.mockResolvedValueOnce([{
      id: 'manual-now-colliding',
      normalizedOrderNo: 'ab-12',
      customerId: 'customer-1',
      needsCustomerFix: false,
      externalSourceLinks: [],
    }]);

    await expect(applyMuContractReconcile('admin-1', 'preview-1', {
      client,
      dbClient: root,
      now: () => fixedNow,
      leaseOwner: 'lease-1',
    })).rejects.toMatchObject({ code: 'MU_CONTRACT_RECONCILE_SOURCE_CHANGED' });

    expect(mockApply).not.toHaveBeenCalled();
  });

  it('rejects duplicate or unstable PI pagination across pages', async () => {
    const firstPage: MuContractSnapshotPage = {
      schemaVersion: 1,
      items: [activeItem('pi-a', 'AB-11')],
      eventHighWatermark: '1042',
      nextAfter: 'pi-a',
      hasMore: true,
    };
    const duplicatePage: MuContractSnapshotPage = {
      schemaVersion: 1,
      items: [activeItem('pi-a', 'AB-12')],
      eventHighWatermark: '1042',
      nextAfter: null,
      hasMore: false,
    };
    const client = makeClient(firstPage);
    client.fetchSnapshot.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(duplicatePage);
    const { root } = makeDb();

    await expect(previewMuContractReconcile('admin-1', {
      client,
      dbClient: root,
      now: () => fixedNow,
    })).rejects.toMatchObject({ code: 'MU_CONTRACT_CURSOR_INVALID' });
  });

  it('resumes from the durable snapshot cursor after an interrupted run', async () => {
    const firstPage: MuContractSnapshotPage = {
      schemaVersion: 1,
      items: [activeItem('pi-a', 'AB-11')],
      eventHighWatermark: '1042',
      nextAfter: 'pi-a',
      hasMore: true,
    };
    const finalPage: MuContractSnapshotPage = {
      schemaVersion: 1,
      items: [activeItem('pi-b', 'AB-12')],
      eventHighWatermark: '1042',
      nextAfter: null,
      hasMore: false,
    };
    const { root } = makeDb({
      state: syncState({
        reconcileStatus: 'FAILED',
        reconcileCursor: 'pi-a',
        reconcileHighWatermark: '1042',
      }),
    });
    const client = makeClient(firstPage);
    client.fetchSnapshot.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(finalPage);
    await persistPreview(root, client);
    client.fetchSnapshot.mockClear();
    client.fetchSnapshot.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(finalPage);

    await applyMuContractReconcile('admin-1', 'preview-1', {
      client,
      dbClient: root,
      now: () => fixedNow,
      leaseOwner: 'lease-1',
    });

    expect(client.fetchSnapshot).toHaveBeenNthCalledWith(1, null, 100);
    expect(client.fetchSnapshot).toHaveBeenNthCalledWith(2, 'pi-a', 100);
    expect(mockApply).toHaveBeenCalledTimes(1);
    expect(mockApply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      state: expect.objectContaining({ source: expect.objectContaining({ piId: 'pi-b' }) }),
    }));
  });

  it('checkpoints each page then hands the event cursor to the captured high-watermark', async () => {
    mockGetSettings.mockResolvedValue({ enabled: false, intervalSeconds: 30, batchSize: 1 });
    const firstPage: MuContractSnapshotPage = {
      schemaVersion: 1,
      items: [activeItem('pi-a', 'AB-12')],
      eventHighWatermark: '1042',
      nextAfter: 'pi-a',
      hasMore: true,
    };
    const finalPage: MuContractSnapshotPage = {
      schemaVersion: 1,
      items: [activeItem('pi-b', 'AB-13')],
      eventHighWatermark: '1042',
      nextAfter: null,
      hasMore: false,
    };
    const client = makeClient(firstPage);
    client.fetchSnapshot
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(finalPage);
    const { root, tx } = makeDb();
    await persistPreview(root, client);
    client.fetchSnapshot.mockClear();
    client.fetchSnapshot
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(finalPage);

    const result = await applyMuContractReconcile('admin-1', 'preview-1', {
      client,
      dbClient: root,
      now: () => fixedNow,
      leaseOwner: 'lease-1',
    });

    expect(client.fetchSnapshot).toHaveBeenNthCalledWith(1, null, 1);
    expect(client.fetchSnapshot).toHaveBeenNthCalledWith(2, 'pi-a', 1);
    expect(client.fetchSnapshot.mock.invocationCallOrder[1]).toBeLessThan(
      mockApply.mock.invocationCallOrder[0],
    );
    expect(tx.integrationSyncState.updateMany).toHaveBeenCalledWith({
      where: { provider: 'MU_CONTRACT', leaseOwner: 'lease-1' },
      data: expect.objectContaining({
        reconcileStatus: 'RUNNING',
        reconcileCursor: 'pi-a',
        reconcileHighWatermark: '1042',
      }),
    });
    expect(tx.integrationSyncState.updateMany).toHaveBeenCalledWith({
      where: { provider: 'MU_CONTRACT', leaseOwner: 'lease-1' },
      data: expect.objectContaining({
        committedCursor: '1042',
        initialReconcileCompletedAt: fixedNow,
        reconcileStatus: 'COMPLETED',
        reconcileCursor: null,
        reconcileHighWatermark: null,
      }),
    });
    expect(tx.integrationReconcilePreview.update).toHaveBeenCalledWith({
      where: { id: 'preview-1' },
      data: { consumedAt: fixedNow },
    });
    expect(result).toEqual(expect.objectContaining({
      status: 'completed',
      processed: 2,
      highWatermark: '1042',
    }));
  });

  it('does not let a reconcile worker record failure after its lease is taken over', async () => {
    const client = makeClient();
    const { root, tx } = makeDb();
    await persistPreview(root, client);
    tx.integrationSyncState.updateMany.mockResolvedValueOnce({ count: 0 });
    root.integrationSyncState.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValue({ count: 0 });

    await expect(applyMuContractReconcile('admin-1', 'preview-1', {
      client,
      dbClient: root,
      now: () => fixedNow,
      leaseOwner: 'expired-worker',
    })).rejects.toMatchObject({ code: 'MU_CONTRACT_LEASE_LOST' });

    expect(root.integrationSyncState.update).not.toHaveBeenCalled();
    expect(root.integrationSyncState.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { provider: 'MU_CONTRACT', leaseOwner: 'expired-worker' },
      data: expect.objectContaining({ lastErrorCode: 'MU_CONTRACT_LEASE_LOST' }),
    }));
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('rejects a consumed preview idempotently', async () => {
    const { root } = makeDb({
      preview: previewRow({ consumedAt: new Date('2026-07-18T09:01:00.000Z') }),
    });

    await expect(applyMuContractReconcile('admin-1', 'preview-1', {
      client: makeClient(),
      dbClient: root,
      now: () => fixedNow,
      leaseOwner: 'lease-1',
    })).rejects.toMatchObject({ code: 'MU_CONTRACT_RECONCILE_PREVIEW_CONSUMED' });
  });
});
