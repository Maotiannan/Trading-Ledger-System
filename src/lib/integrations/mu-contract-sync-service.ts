import { createHash, randomUUID } from 'node:crypto';

import { ExternalCustomerMatchStatus, IntegrationConflictStatus } from '@prisma/client';

import { db } from '@/lib/db';
import {
  createMuContractClient,
  MuContractClientError,
  type MuContractClient,
} from '@/lib/integrations/mu-contract-client';
import {
  isMuContractInvalidEvent,
  MuContractContractError,
  type MuContractOrderEvent,
  type MuContractParsedEvent,
} from '@/lib/integrations/mu-contract-contract';
import {
  MU_CONTRACT_LEASE_MS,
  MU_CONTRACT_PROVIDER,
} from '@/lib/integrations/mu-contract-constants';
import {
  applyMuContractOrderState,
  type MuContractApplyResult,
} from '@/lib/integrations/mu-contract-order-applier';
import { getMuContractSyncSettings } from '@/lib/integrations/mu-contract-sync-settings';

export type MuContractSyncErrorCode =
  | 'MU_CONTRACT_INITIAL_RECONCILE_REQUIRED'
  | 'MU_CONTRACT_LEASE_LOST'
  | 'MU_CONTRACT_CURSOR_INVALID'
  | 'MU_CONTRACT_EVENT_ID_REUSED'
  | 'MU_CONTRACT_SYNC_FAILED'
  | 'MU_CONTRACT_RECONCILE_PREVIEW_NOT_FOUND'
  | 'MU_CONTRACT_RECONCILE_PREVIEW_EXPIRED'
  | 'MU_CONTRACT_RECONCILE_PREVIEW_CONSUMED'
  | 'MU_CONTRACT_RECONCILE_SOURCE_CHANGED';

export class MuContractSyncError extends Error {
  readonly code: MuContractSyncErrorCode;

  constructor(code: MuContractSyncErrorCode) {
    super(`MU Contract synchronization failed (${code})`);
    this.name = 'MuContractSyncError';
    this.code = code;
  }
}

type DatabaseOverride = object;
type Clock = () => Date;

export type MuContractSyncDependencies = {
  client?: MuContractClient;
  dbClient?: DatabaseOverride;
  now?: Clock;
  leaseOwner?: string;
};

export type MuContractSyncRunResult = {
  status:
    | 'completed'
    | 'running'
    | 'disabled'
    | 'not-due'
    | 'initial-reconcile-required';
  processed: number;
  conflicts: number;
  committedCursor: string | null;
};

function databaseFrom(value?: DatabaseOverride): typeof db {
  return (value ?? db) as typeof db;
}

function clockFrom(value?: Clock): Clock {
  return value ?? (() => new Date());
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function eventHash(event: MuContractOrderEvent): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(event)))
    .digest('hex');
}

function cursorGreaterThan(left: string, right: string | null): boolean {
  return right === null || BigInt(left) > BigInt(right);
}

function safeErrorCode(error: unknown): string {
  if (
    error instanceof MuContractSyncError
    || error instanceof MuContractClientError
    || error instanceof MuContractContractError
  ) {
    return error.code;
  }
  return 'MU_CONTRACT_SYNC_FAILED';
}

function safeErrorMessage(code: string): string {
  return `MU Contract synchronization stopped (${code})`;
}

function safeThrownError(error: unknown): Error {
  if (
    error instanceof MuContractSyncError
    || error instanceof MuContractClientError
    || error instanceof MuContractContractError
  ) {
    return error;
  }
  return new MuContractSyncError('MU_CONTRACT_SYNC_FAILED');
}

export async function ensureMuContractSyncState(
  database: typeof db,
  actorId: string,
) {
  return database.integrationSyncState.upsert({
    where: { provider: MU_CONTRACT_PROVIDER },
    create: {
      provider: MU_CONTRACT_PROVIDER,
      serviceActorId: actorId,
    },
    update: {},
  });
}

export async function acquireMuContractLease(
  database: typeof db,
  leaseOwner: string,
  now: Date,
): Promise<boolean> {
  const acquired = await database.integrationSyncState.updateMany({
    where: {
      provider: MU_CONTRACT_PROVIDER,
      OR: [
        { leaseOwner: null },
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lte: now } },
        { leaseOwner },
      ],
    },
    data: {
      leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + MU_CONTRACT_LEASE_MS),
      lastAttemptAt: now,
    },
  });
  return acquired.count === 1;
}

export async function renewMuContractLease(
  database: typeof db,
  leaseOwner: string,
  now: Date,
): Promise<void> {
  const renewed = await database.integrationSyncState.updateMany({
    where: {
      provider: MU_CONTRACT_PROVIDER,
      leaseOwner,
      leaseExpiresAt: { gt: now },
    },
    data: {
      leaseExpiresAt: new Date(now.getTime() + MU_CONTRACT_LEASE_MS),
    },
  });
  if (renewed.count !== 1) {
    throw new MuContractSyncError('MU_CONTRACT_LEASE_LOST');
  }
}

export async function releaseMuContractLease(
  database: typeof db,
  leaseOwner: string,
): Promise<void> {
  await database.integrationSyncState.updateMany({
    where: { provider: MU_CONTRACT_PROVIDER, leaseOwner },
    data: { leaseOwner: null, leaseExpiresAt: null },
  });
}

async function processEvent(
  database: typeof db,
  event: MuContractParsedEvent,
  actorId: string,
  leaseOwner: string,
  now: Clock,
): Promise<MuContractApplyResult> {
  const payloadHash = isMuContractInvalidEvent(event) ? event.payloadHash : eventHash(event);
  return database.$transaction(async (tx) => {
    const transactionStartedAt = now();
    const lease = await tx.integrationSyncState.updateMany({
      where: {
        provider: MU_CONTRACT_PROVIDER,
        leaseOwner,
        leaseExpiresAt: { gt: transactionStartedAt },
      },
      data: {
        leaseExpiresAt: new Date(transactionStartedAt.getTime() + MU_CONTRACT_LEASE_MS),
      },
    });
    if (lease.count !== 1) {
      throw new MuContractSyncError('MU_CONTRACT_LEASE_LOST');
    }

    const existingReceipt = await tx.integrationEventReceipt.findUnique({
      where: {
        provider_eventId: {
          provider: MU_CONTRACT_PROVIDER,
          eventId: event.eventId,
        },
      },
    });

    if (existingReceipt) {
      if (existingReceipt.payloadHash !== payloadHash) {
        throw new MuContractSyncError('MU_CONTRACT_EVENT_ID_REUSED');
      }
      await tx.integrationSyncState.update({
        where: { provider: MU_CONTRACT_PROVIDER },
        data: {
          committedCursor: event.cursor,
          leaseExpiresAt: new Date(now().getTime() + MU_CONTRACT_LEASE_MS),
        },
      });
      return {
        result: existingReceipt.result,
        orderTrackerId: existingReceipt.orderTrackerId,
        linkMode: null,
        conflictType: null,
      } as MuContractApplyResult;
    }

    const result: MuContractApplyResult = isMuContractInvalidEvent(event)
      ? {
          result: 'BUSINESS_CONFLICT',
          orderTrackerId: null,
          linkMode: null,
          conflictType: 'INVALID_SOURCE_DATA',
        }
      : await applyMuContractOrderState(tx, {
          state: event,
          actorId,
          cursor: event.cursor,
        });
    if (isMuContractInvalidEvent(event)) {
      const dedupeKey = `${MU_CONTRACT_PROVIDER}:${event.source.piId}:INVALID_SOURCE_DATA`;
      const conflict = {
        provider: MU_CONTRACT_PROVIDER,
        sourcePiId: event.source.piId,
        sourceVersion: event.source.version,
        eventId: event.eventId,
        cursor: event.cursor,
        type: 'INVALID_SOURCE_DATA' as const,
        sourceOrderNo: null,
        targetOrderTrackerIds: [],
        summary: 'MU Contract source data is invalid',
        evidence: { issuePath: event.issuePath },
        status: IntegrationConflictStatus.OPEN,
        resolutionNote: null,
        resolvedAt: null,
        resolvedBy: null,
      };
      await tx.integrationSyncConflict.upsert({
        where: { dedupeKey },
        create: { dedupeKey, ...conflict },
        update: conflict,
      });
    }
    const processedAt = now();
    await tx.integrationEventReceipt.create({
      data: {
        provider: MU_CONTRACT_PROVIDER,
        eventId: event.eventId,
        cursor: event.cursor,
        sourcePiId: event.source.piId,
        sourceVersion: event.source.version,
        payloadHash,
        result: result.result,
        orderTrackerId: result.orderTrackerId,
        processedAt,
      },
    });
    await tx.integrationSyncState.update({
      where: { provider: MU_CONTRACT_PROVIDER },
      data: {
        committedCursor: event.cursor,
        leaseExpiresAt: new Date(processedAt.getTime() + MU_CONTRACT_LEASE_MS),
      },
    });
    return result;
  });
}

async function runIncremental(
  params: {
    actorId: string;
    initialState: Awaited<ReturnType<typeof ensureMuContractSyncState>>;
    manual: boolean;
  } & MuContractSyncDependencies,
): Promise<MuContractSyncRunResult> {
  const database = databaseFrom(params.dbClient);
  const now = clockFrom(params.now);
  const settings = await getMuContractSyncSettings();
  const client = params.client ?? createMuContractClient();
  const leaseOwner = params.leaseOwner ?? randomUUID();

  if (!params.initialState.initialReconcileCompletedAt) {
    if (params.manual) {
      throw new MuContractSyncError('MU_CONTRACT_INITIAL_RECONCILE_REQUIRED');
    }
    return {
      status: 'initial-reconcile-required',
      processed: 0,
      conflicts: 0,
      committedCursor: params.initialState.committedCursor,
    };
  }

  const acquired = await acquireMuContractLease(database, leaseOwner, now());
  if (!acquired) {
    return {
      status: 'running',
      processed: 0,
      conflicts: 0,
      committedCursor: params.initialState.committedCursor,
    };
  }

  let cursor = params.initialState.committedCursor;
  let processed = 0;
  let conflicts = 0;

  try {
    let hasMore = true;
    while (hasMore) {
      const page = await client.fetchEvents(cursor, settings.batchSize);
      for (const event of page.events) {
        if (!cursorGreaterThan(event.cursor, cursor)) {
          throw new MuContractSyncError('MU_CONTRACT_CURSOR_INVALID');
        }
        await renewMuContractLease(database, leaseOwner, now());
        const result = await processEvent(database, event, params.actorId, leaseOwner, now);
        cursor = event.cursor;
        processed += 1;
        if (result.result === 'BUSINESS_CONFLICT') conflicts += 1;
      }
      hasMore = page.hasMore;
      if (hasMore && page.nextCursor !== cursor) {
        throw new MuContractSyncError('MU_CONTRACT_CURSOR_INVALID');
      }
    }

    const completedAt = now();
    const completed = await database.integrationSyncState.updateMany({
      where: {
        provider: MU_CONTRACT_PROVIDER,
        leaseOwner,
        leaseExpiresAt: { gt: completedAt },
      },
      data: {
        lastSuccessAt: completedAt,
        lastErrorCode: null,
        lastErrorMessage: null,
        nextEligiblePollAt: new Date(completedAt.getTime() + settings.intervalSeconds * 1000),
      },
    });
    if (completed.count !== 1) throw new MuContractSyncError('MU_CONTRACT_LEASE_LOST');
    return { status: 'completed', processed, conflicts, committedCursor: cursor };
  } catch (error) {
    const code = safeErrorCode(error);
    await database.integrationSyncState.updateMany({
      where: { provider: MU_CONTRACT_PROVIDER, leaseOwner },
      data: {
        lastErrorCode: code,
        lastErrorMessage: safeErrorMessage(code),
        nextEligiblePollAt: new Date(now().getTime() + settings.intervalSeconds * 1000),
      },
    });
    throw safeThrownError(error);
  } finally {
    await releaseMuContractLease(database, leaseOwner);
  }
}

export async function runMuContractSyncNow(
  params: { actorId: string } & MuContractSyncDependencies,
): Promise<MuContractSyncRunResult> {
  const database = databaseFrom(params.dbClient);
  const initialState = await ensureMuContractSyncState(database, params.actorId);
  return runIncremental({ ...params, initialState, manual: true });
}

export async function runScheduledMuContractSync(
  params: MuContractSyncDependencies = {},
): Promise<MuContractSyncRunResult> {
  const database = databaseFrom(params.dbClient);
  const now = clockFrom(params.now);
  const settings = await getMuContractSyncSettings();
  if (!settings.enabled) {
    return { status: 'disabled', processed: 0, conflicts: 0, committedCursor: null };
  }

  const state = await database.integrationSyncState.findUnique({
    where: { provider: MU_CONTRACT_PROVIDER },
  });
  if (!state || !state.initialReconcileCompletedAt) {
    return {
      status: 'initial-reconcile-required',
      processed: 0,
      conflicts: 0,
      committedCursor: state?.committedCursor ?? null,
    };
  }
  if (state.nextEligiblePollAt && state.nextEligiblePollAt > now()) {
    return {
      status: 'not-due',
      processed: 0,
      conflicts: 0,
      committedCursor: state.committedCursor,
    };
  }

  return runIncremental({
    ...params,
    actorId: state.serviceActorId,
    initialState: state,
    manual: false,
  });
}

export async function getMuContractSyncStatus(
  params: Pick<MuContractSyncDependencies, 'dbClient' | 'now'> = {},
) {
  const database = databaseFrom(params.dbClient);
  const now = clockFrom(params.now)();
  const [settings, state, unmatchedCount, conflictCount] = await Promise.all([
    getMuContractSyncSettings(),
    database.integrationSyncState.findUnique({ where: { provider: MU_CONTRACT_PROVIDER } }),
    database.externalOrderSourceLink.count({
      where: {
        provider: MU_CONTRACT_PROVIDER,
        active: true,
        customerMatchStatus: { not: ExternalCustomerMatchStatus.MATCHED },
      },
    }),
    database.integrationSyncConflict.count({
      where: {
        provider: MU_CONTRACT_PROVIDER,
        status: IntegrationConflictStatus.OPEN,
      },
    }),
  ]);

  return {
    enabled: settings.enabled,
    intervalSeconds: settings.intervalSeconds,
    batchSize: settings.batchSize,
    initialReconcileCompletedAt: state?.initialReconcileCompletedAt?.toISOString() ?? null,
    committedCursor: state?.committedCursor ?? null,
    lastAttemptAt: state?.lastAttemptAt?.toISOString() ?? null,
    lastSuccessAt: state?.lastSuccessAt?.toISOString() ?? null,
    lastError: state?.lastErrorCode ?? null,
    nextEligiblePollAt: state?.nextEligiblePollAt?.toISOString() ?? null,
    running: Boolean(state?.leaseOwner && state.leaseExpiresAt && state.leaseExpiresAt > now),
    reconcileStatus: state?.reconcileStatus ?? 'IDLE',
    unmatchedCount,
    conflictCount,
  };
}
