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
    client.fetchSnapshotHighWatermark.mockResolvedValueOnce('1043');

    await expect(applyMuContractReconcile('admin-1', 'preview-1', {
      client,
      dbClient: root,
      now: () => fixedNow,
      leaseOwner: 'lease-1',
    })).rejects.toMatchObject({ code: 'MU_CONTRACT_RECONCILE_SOURCE_CHANGED' });

    expect(root.integrationSyncState.updateMany).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('resumes from the durable snapshot cursor after an interrupted run', async () => {
    const page = snapshotFixture();
    const { root } = makeDb({
      state: syncState({
        reconcileStatus: 'FAILED',
        reconcileCursor: 'pi-a',
        reconcileHighWatermark: '1042',
      }),
    });
    const client = makeClient(page);

    await applyMuContractReconcile('admin-1', 'preview-1', {
      client,
      dbClient: root,
      now: () => fixedNow,
      leaseOwner: 'lease-1',
    });

    expect(client.fetchSnapshot).toHaveBeenCalledWith('pi-a', 100);
  });

  it('checkpoints each page then hands the event cursor to the captured high-watermark', async () => {
    const firstPage: MuContractSnapshotPage = {
      schemaVersion: 1,
      items: [activeItem('pi-a', 'AB-12')],
      eventHighWatermark: '1042',
      nextAfter: 'pi-a',
      hasMore: true,
    };
    const finalPage = snapshotFixture();
    const client = makeClient(firstPage);
    client.fetchSnapshot
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(finalPage);
    const { root, tx } = makeDb();

    const result = await applyMuContractReconcile('admin-1', 'preview-1', {
      client,
      dbClient: root,
      now: () => fixedNow,
      leaseOwner: 'lease-1',
    });

    expect(client.fetchSnapshot).toHaveBeenNthCalledWith(1, null, 100);
    expect(client.fetchSnapshot).toHaveBeenNthCalledWith(2, 'pi-a', 100);
    expect(tx.integrationSyncState.update).toHaveBeenCalledWith({
      where: { provider: 'MU_CONTRACT' },
      data: expect.objectContaining({
        reconcileStatus: 'RUNNING',
        reconcileCursor: 'pi-a',
        reconcileHighWatermark: '1042',
      }),
    });
    expect(tx.integrationSyncState.update).toHaveBeenCalledWith({
      where: { provider: 'MU_CONTRACT' },
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
