import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { MuContractClient } from '@/lib/integrations/mu-contract-client';
import { applyMuContractOrderState } from '@/lib/integrations/mu-contract-order-applier';
import { getMuContractSyncSettings } from '@/lib/integrations/mu-contract-sync-settings';
import {
  MuContractSyncError,
  getMuContractSyncStatus,
  runMuContractSyncNow,
  runScheduledMuContractSync,
} from '@/lib/integrations/mu-contract-sync-service';
import type { MuContractEventPage, MuContractOrderEvent } from '@/lib/integrations/mu-contract-contract';

jest.mock('@/lib/integrations/mu-contract-order-applier', () => ({
  applyMuContractOrderState: jest.fn(),
}));

jest.mock('@/lib/integrations/mu-contract-sync-settings', () => ({
  getMuContractSyncSettings: jest.fn(),
}));

const mockApply = applyMuContractOrderState as jest.Mock;
const mockGetSettings = getMuContractSyncSettings as jest.Mock;

function eventPage(): MuContractEventPage {
  return JSON.parse(readFileSync(
    path.join(process.cwd(), 'tests/fixtures/mu-contract-order-sync/formal-generated.json'),
    'utf8',
  ));
}

function state(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'MU_CONTRACT',
    committedCursor: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextEligiblePollAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    reconcileStatus: 'COMPLETED',
    reconcileCursor: null,
    reconcileHighWatermark: null,
    initialReconcileCompletedAt: new Date('2026-07-17T00:00:00.000Z'),
    serviceActorId: 'admin-1',
    ...overrides,
  };
}

function makeClient(page = eventPage()) {
  return {
    fetchEvents: jest.fn().mockResolvedValue(page),
    fetchSnapshot: jest.fn(),
    fetchSnapshotHighWatermark: jest.fn(),
  } as unknown as jest.Mocked<MuContractClient>;
}

function makeDb(initialState = state()) {
  const tx = {
    integrationEventReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }) => ({ id: 'receipt-1', ...data })),
    },
    integrationSyncState: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(async ({ data }) => ({ ...initialState, ...data })),
    },
  };
  const root = {
    integrationSyncState: {
      findUnique: jest.fn().mockResolvedValue(initialState),
      upsert: jest.fn().mockResolvedValue(initialState),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(async ({ data }) => ({ ...initialState, ...data })),
    },
    externalOrderSourceLink: {
      count: jest.fn().mockResolvedValue(0),
    },
    integrationSyncConflict: {
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  return { root, tx };
}

const fixedNow = new Date('2026-07-18T09:00:00.000Z');

describe('MU Contract incremental synchronization', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockGetSettings.mockResolvedValue({
      enabled: true,
      intervalSeconds: 30,
      batchSize: 100,
    });
    mockApply.mockResolvedValue({
      result: 'APPLIED',
      orderTrackerId: 'tracker-1',
      linkMode: 'MANUAL_ATTACHED',
      conflictType: null,
    });
  });

  it('commits the event receipt and cursor in the same transaction', async () => {
    const { root, tx } = makeDb();
    const client = makeClient();

    const result = await runMuContractSyncNow({
      actorId: 'admin-1',
      client,
      dbClient: root,
      now: () => fixedNow,
      leaseOwner: 'lease-1',
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'completed',
      processed: 1,
      committedCursor: '1042',
    }));
    expect(root.$transaction).toHaveBeenCalled();
    expect(tx.integrationEventReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'MU_CONTRACT',
        eventId: 'c5a5c257-b3ec-4ce2-b54d-83f8f1aab7e2',
        cursor: '1042',
        result: 'APPLIED',
      }),
    });
    expect(tx.integrationSyncState.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ committedCursor: '1042' }),
    }));
    expect(mockApply).toHaveBeenCalledWith(tx, expect.objectContaining({ cursor: '1042' }));
  });

  it('does not advance the cursor when the source request fails transiently', async () => {
    const { root, tx } = makeDb();
    const client = makeClient();
    client.fetchEvents.mockRejectedValue(new Error('timeout with upstream details'));

    await expect(runMuContractSyncNow({
      actorId: 'admin-1',
      client,
      dbClient: root,
      now: () => fixedNow,
      leaseOwner: 'lease-1',
    })).rejects.toThrow();

    expect(tx.integrationEventReceipt.create).not.toHaveBeenCalled();
    expect(tx.integrationSyncState.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ committedCursor: expect.anything() }),
    }));
    expect(root.integrationSyncState.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        lastErrorCode: expect.any(String),
        lastErrorMessage: expect.not.stringContaining('upstream details'),
      }),
    }));
  });

  it('returns running without contacting the source when another lease is active', async () => {
    const { root } = makeDb();
    root.integrationSyncState.updateMany.mockResolvedValueOnce({ count: 0 });
    const client = makeClient();

    const result = await runMuContractSyncNow({
      actorId: 'admin-1',
      client,
      dbClient: root,
      now: () => fixedNow,
      leaseOwner: 'lease-2',
    });

    expect(result.status).toBe('running');
    expect(client.fetchEvents).not.toHaveBeenCalled();
  });

  it('does no work when scheduled synchronization is disabled', async () => {
    mockGetSettings.mockResolvedValueOnce({ enabled: false, intervalSeconds: 30, batchSize: 100 });
    const { root } = makeDb();
    const client = makeClient();

    const result = await runScheduledMuContractSync({
      client,
      dbClient: root,
      now: () => fixedNow,
      leaseOwner: 'lease-1',
    });

    expect(result.status).toBe('disabled');
    expect(root.integrationSyncState.updateMany).not.toHaveBeenCalled();
    expect(client.fetchEvents).not.toHaveBeenCalled();
  });

  it('blocks incremental synchronization before the initial reconcile', async () => {
    const { root } = makeDb(state({ initialReconcileCompletedAt: null, reconcileStatus: 'IDLE' }));
    const client = makeClient();

    await expect(runMuContractSyncNow({
      actorId: 'admin-1',
      client,
      dbClient: root,
      now: () => fixedNow,
      leaseOwner: 'lease-1',
    })).rejects.toMatchObject({
      code: 'MU_CONTRACT_INITIAL_RECONCILE_REQUIRED',
    });
    expect(client.fetchEvents).not.toHaveBeenCalled();
  });

  it('records stale and business-conflict events while advancing the cursor', async () => {
    const page = eventPage();
    const second = {
      ...page.events[0],
      cursor: '1043',
      eventId: '46c25864-bffd-4d15-9e92-f536ece57585',
      source: { ...page.events[0].source, version: page.events[0].source.version + 1 },
    } as MuContractOrderEvent;
    page.events = [page.events[0], second];
    page.nextCursor = '1043';
    const client = makeClient(page);
    const { root, tx } = makeDb();
    mockApply
      .mockResolvedValueOnce({
        result: 'IGNORED_STALE',
        orderTrackerId: 'tracker-1',
        linkMode: 'MANUAL_ATTACHED',
        conflictType: null,
      })
      .mockResolvedValueOnce({
        result: 'BUSINESS_CONFLICT',
        orderTrackerId: null,
        linkMode: null,
        conflictType: 'ORDER_NO_COLLISION',
      });

    const result = await runMuContractSyncNow({
      actorId: 'admin-1',
      client,
      dbClient: root,
      now: () => fixedNow,
      leaseOwner: 'lease-1',
    });

    expect(result).toEqual(expect.objectContaining({
      processed: 2,
      conflicts: 1,
      committedCursor: '1043',
    }));
    expect(tx.integrationEventReceipt.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({ result: 'IGNORED_STALE', cursor: '1042' }),
    });
    expect(tx.integrationEventReceipt.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({ result: 'BUSINESS_CONFLICT', cursor: '1043' }),
    });
  });

  it('reports safe status counts without returning environment credentials', async () => {
    const { root } = makeDb(state({ committedCursor: '1042' }));
    root.externalOrderSourceLink.count.mockResolvedValueOnce(3);
    root.integrationSyncConflict.count.mockResolvedValueOnce(2);

    const result = await getMuContractSyncStatus({ dbClient: root });

    expect(result).toEqual(expect.objectContaining({
      committedCursor: '1042',
      unmatchedCount: 3,
      conflictCount: 2,
    }));
    expect(JSON.stringify(result)).not.toContain('TOKEN');
    expect(JSON.stringify(result)).not.toContain('Authorization');
  });

  it('uses a stable safe error type for reconcile gating', () => {
    const error = new MuContractSyncError('MU_CONTRACT_INITIAL_RECONCILE_REQUIRED');
    expect(String(error)).toBe(
      'MuContractSyncError: MU Contract synchronization failed (MU_CONTRACT_INITIAL_RECONCILE_REQUIRED)',
    );
  });
});
