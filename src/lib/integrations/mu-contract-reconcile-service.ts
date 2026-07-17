import { createHash, randomUUID } from 'node:crypto';

import { IntegrationReconcileStatus, Prisma } from '@prisma/client';

import { db } from '@/lib/db';
import { createMuContractClient, type MuContractClient } from '@/lib/integrations/mu-contract-client';
import type {
  MuContractOrderEvent,
  MuContractSnapshotItem,
} from '@/lib/integrations/mu-contract-contract';
import {
  MU_CONTRACT_LEASE_MS,
  MU_CONTRACT_PROVIDER,
} from '@/lib/integrations/mu-contract-constants';
import { resolveMuContractOrderCustomer } from '@/lib/integrations/mu-contract-customer-resolver';
import { applyMuContractOrderState } from '@/lib/integrations/mu-contract-order-applier';
import { getMuContractSyncSettings } from '@/lib/integrations/mu-contract-sync-settings';
import {
  MuContractSyncError,
  acquireMuContractLease,
  ensureMuContractSyncState,
  releaseMuContractLease,
  renewMuContractLease,
  type MuContractSyncDependencies,
} from '@/lib/integrations/mu-contract-sync-service';
import { normalizeOrderIdentifier } from '@/lib/order-name-kernel';

const PREVIEW_TTL_MS = 15 * 60 * 1000;

export type MuContractReconcileSummary = {
  totalSourceRows: number;
  metadataOnly: number;
  creates: number;
  updates: number;
  inactive: number;
  unmatched: number;
  conflicts: number;
  manualOnlyUntouched: number;
};

export type MuContractReconcileRunResult = {
  status: 'completed' | 'running';
  processed: number;
  conflicts: number;
  highWatermark: string;
};

type ReconcileDependencies = MuContractSyncDependencies;

function databaseFrom(value?: object): typeof db {
  return (value ?? db) as typeof db;
}

function clockFrom(value?: () => Date): () => Date {
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

function summaryHash(summary: MuContractReconcileSummary): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(summary)))
    .digest('hex');
}

async function readSnapshot(client: MuContractClient, batchSize: number) {
  const items: MuContractSnapshotItem[] = [];
  let after: string | null = null;
  let highWatermark: string | null = null;
  let hasMore = true;

  while (hasMore) {
    const page = await client.fetchSnapshot(after, batchSize);
    highWatermark ??= page.eventHighWatermark;
    items.push(...page.items);
    hasMore = page.hasMore;
    if (hasMore && (!page.nextAfter || page.nextAfter === after)) {
      throw new MuContractSyncError('MU_CONTRACT_CURSOR_INVALID');
    }
    after = page.nextAfter;
  }

  return { items, highWatermark: highWatermark ?? '0' };
}

async function buildPreviewSummary(
  database: typeof db,
  items: MuContractSnapshotItem[],
): Promise<MuContractReconcileSummary> {
  const [links, trackers] = await Promise.all([
    database.externalOrderSourceLink.findMany({
      where: { provider: MU_CONTRACT_PROVIDER },
      include: { orderTracker: true },
    }),
    database.orderTracker.findMany({
      where: { archivedAt: null },
      select: {
        id: true,
        normalizedOrderNo: true,
        customerId: true,
        needsCustomerFix: true,
        externalSourceLinks: {
          where: { provider: MU_CONTRACT_PROVIDER },
          select: { externalId: true },
        },
      },
    }),
  ]);

  const linksByPi = new Map(links.map((link) => [link.externalId, link]));
  const trackersByOrder = new Map(trackers.map((row) => [row.normalizedOrderNo, row]));
  const sourceOrderCounts = new Map<string, number>();
  for (const item of items) {
    const normalized = normalizeOrderIdentifier(item.order.orderNo);
    sourceOrderCounts.set(normalized, (sourceOrderCounts.get(normalized) ?? 0) + 1);
  }

  const summary: MuContractReconcileSummary = {
    totalSourceRows: items.length,
    metadataOnly: 0,
    creates: 0,
    updates: 0,
    inactive: 0,
    unmatched: 0,
    conflicts: 0,
    manualOnlyUntouched: 0,
  };

  for (const item of items) {
    const normalized = normalizeOrderIdentifier(item.order.orderNo);
    const link = linksByPi.get(item.source.piId);
    const tracker = trackersByOrder.get(normalized);
    if (!item.order.active) summary.inactive += 1;

    if ((sourceOrderCounts.get(normalized) ?? 0) > 1) {
      summary.conflicts += 1;
      continue;
    }

    if (link) {
      if (item.source.version >= link.sourceVersion) summary.updates += 1;
      if (link.customerMatchStatus !== 'MATCHED') summary.unmatched += 1;
      continue;
    }

    if (tracker) {
      if (tracker.externalSourceLinks.length > 0) {
        summary.conflicts += 1;
      } else {
        summary.metadataOnly += 1;
        if (!tracker.customerId || tracker.needsCustomerFix) summary.unmatched += 1;
      }
      continue;
    }

    summary.creates += 1;
    const customer = await resolveMuContractOrderCustomer(database, item.order.orderNo);
    if (customer.status !== 'MATCHED') summary.unmatched += 1;
    if (customer.status === 'CONFLICT') summary.conflicts += 1;
  }

  const sourceOrders = new Set(items.map((item) => normalizeOrderIdentifier(item.order.orderNo)));
  summary.manualOnlyUntouched = trackers.filter((row) => (
    row.externalSourceLinks.length === 0 && !sourceOrders.has(row.normalizedOrderNo)
  )).length;

  return summary;
}

export async function previewMuContractReconcile(
  actorId: string,
  dependencies: ReconcileDependencies = {},
): Promise<{
  previewId: string;
  expiresAt: string;
  highWatermark: string;
  summary: MuContractReconcileSummary;
}> {
  const database = databaseFrom(dependencies.dbClient);
  const now = clockFrom(dependencies.now);
  const client = dependencies.client ?? createMuContractClient();
  const settings = await getMuContractSyncSettings();
  const snapshot = await readSnapshot(client, settings.batchSize);
  const summary = await buildPreviewSummary(database, snapshot.items);
  const createdAt = now();
  const expiresAt = new Date(createdAt.getTime() + PREVIEW_TTL_MS);
  const preview = await database.integrationReconcilePreview.create({
    data: {
      provider: MU_CONTRACT_PROVIDER,
      sourceHighWatermark: snapshot.highWatermark,
      snapshotSummary: summary as unknown as Prisma.InputJsonValue,
      summaryHash: summaryHash(summary),
      createdBy: actorId,
      createdAt,
      expiresAt,
    },
  });

  return {
    previewId: preview.id,
    expiresAt: expiresAt.toISOString(),
    highWatermark: snapshot.highWatermark,
    summary,
  };
}

function syntheticEventId(item: MuContractSnapshotItem, highWatermark: string): string {
  const hash = createHash('sha256')
    .update(`${item.source.piId}:${item.source.version}:${highWatermark}`)
    .digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function snapshotEvent(item: MuContractSnapshotItem, highWatermark: string): MuContractOrderEvent {
  const occurredAt = item.order.deletedAt
    ?? item.officialAmount?.generatedAt
    ?? item.order.piCreatedAt;
  if (!item.order.active) {
    return {
      cursor: highWatermark,
      eventId: syntheticEventId(item, highWatermark),
      eventType: 'PI_SOURCE_DEACTIVATED',
      reason: 'PI_DELETED',
      occurredAt,
      ...item,
    };
  }
  if (item.officialAmount) {
    return {
      cursor: highWatermark,
      eventId: syntheticEventId(item, highWatermark),
      eventType: 'PI_FORMAL_PDF_GENERATED',
      reason: 'FORMAL_PDF_GENERATED',
      occurredAt,
      ...item,
    };
  }
  return {
    cursor: highWatermark,
    eventId: syntheticEventId(item, highWatermark),
    eventType: 'PI_ORDER_LINKED',
    reason: 'ORDER_ASSIGNED',
    occurredAt,
    ...item,
  };
}

function maxCursor(current: string | null, highWatermark: string): string {
  if (current === null) return highWatermark;
  return BigInt(current) >= BigInt(highWatermark) ? current : highWatermark;
}

function assertPreviewUsable(
  preview: {
    createdBy: string;
    expiresAt: Date;
    consumedAt: Date | null;
  } | null,
  actorId: string,
  now: Date,
): asserts preview is NonNullable<typeof preview> {
  if (!preview || preview.createdBy !== actorId) {
    throw new MuContractSyncError('MU_CONTRACT_RECONCILE_PREVIEW_NOT_FOUND');
  }
  if (preview.consumedAt) {
    throw new MuContractSyncError('MU_CONTRACT_RECONCILE_PREVIEW_CONSUMED');
  }
  if (preview.expiresAt <= now) {
    throw new MuContractSyncError('MU_CONTRACT_RECONCILE_PREVIEW_EXPIRED');
  }
}

export async function applyMuContractReconcile(
  actorId: string,
  previewId: string,
  dependencies: ReconcileDependencies = {},
): Promise<MuContractReconcileRunResult> {
  const database = databaseFrom(dependencies.dbClient);
  const now = clockFrom(dependencies.now);
  const client = dependencies.client ?? createMuContractClient();
  const settings = await getMuContractSyncSettings();
  const preview = await database.integrationReconcilePreview.findUnique({
    where: { id: previewId },
  });
  assertPreviewUsable(preview, actorId, now());

  const currentHighWatermark = await client.fetchSnapshotHighWatermark();
  if (currentHighWatermark !== preview.sourceHighWatermark) {
    throw new MuContractSyncError('MU_CONTRACT_RECONCILE_SOURCE_CHANGED');
  }

  const state = await ensureMuContractSyncState(database, actorId);
  const leaseOwner = dependencies.leaseOwner ?? randomUUID();
  const acquired = await acquireMuContractLease(database, leaseOwner, now());
  if (!acquired) {
    return {
      status: 'running',
      processed: 0,
      conflicts: 0,
      highWatermark: preview.sourceHighWatermark,
    };
  }

  const canResume = state.reconcileHighWatermark === preview.sourceHighWatermark
    && state.reconcileCursor !== null;
  let after = canResume ? state.reconcileCursor : null;
  let processed = 0;
  let conflicts = 0;

  try {
    await database.integrationSyncState.update({
      where: { provider: MU_CONTRACT_PROVIDER },
      data: {
        reconcileStatus: IntegrationReconcileStatus.RUNNING,
        reconcileCursor: after,
        reconcileHighWatermark: preview.sourceHighWatermark,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });

    let hasMore = true;
    while (hasMore) {
      await renewMuContractLease(database, leaseOwner, now());
      const page = await client.fetchSnapshot(after, settings.batchSize);
      const pageResults = await database.$transaction(async (tx) => {
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
        const results = [];
        for (const item of page.items) {
          results.push(await applyMuContractOrderState(tx, {
            state: snapshotEvent(item, preview.sourceHighWatermark),
            actorId,
            cursor: preview.sourceHighWatermark,
          }));
        }
        await tx.integrationSyncState.update({
          where: { provider: MU_CONTRACT_PROVIDER },
          data: {
            reconcileStatus: IntegrationReconcileStatus.RUNNING,
            reconcileCursor: page.hasMore ? page.nextAfter : null,
            reconcileHighWatermark: preview.sourceHighWatermark,
          },
        });
        return results;
      });

      processed += pageResults.length;
      conflicts += pageResults.filter((result) => result.result === 'BUSINESS_CONFLICT').length;
      hasMore = page.hasMore;
      if (hasMore && (!page.nextAfter || page.nextAfter === after)) {
        throw new MuContractSyncError('MU_CONTRACT_CURSOR_INVALID');
      }
      after = page.nextAfter;
    }

    const completedAt = now();
    const committedCursor = maxCursor(state.committedCursor, preview.sourceHighWatermark);
    await database.$transaction(async (tx) => {
      const lease = await tx.integrationSyncState.updateMany({
        where: {
          provider: MU_CONTRACT_PROVIDER,
          leaseOwner,
          leaseExpiresAt: { gt: completedAt },
        },
        data: {
          leaseExpiresAt: new Date(completedAt.getTime() + MU_CONTRACT_LEASE_MS),
        },
      });
      if (lease.count !== 1) {
        throw new MuContractSyncError('MU_CONTRACT_LEASE_LOST');
      }
      await tx.integrationSyncState.update({
        where: { provider: MU_CONTRACT_PROVIDER },
        data: {
          committedCursor,
          initialReconcileCompletedAt: completedAt,
          reconcileStatus: IntegrationReconcileStatus.COMPLETED,
          reconcileCursor: null,
          reconcileHighWatermark: null,
          lastSuccessAt: completedAt,
          lastErrorCode: null,
          lastErrorMessage: null,
          nextEligiblePollAt: new Date(completedAt.getTime() + settings.intervalSeconds * 1000),
        },
      });
      await tx.integrationReconcilePreview.update({
        where: { id: previewId },
        data: { consumedAt: completedAt },
      });
    });

    return {
      status: 'completed',
      processed,
      conflicts,
      highWatermark: preview.sourceHighWatermark,
    };
  } catch (error) {
    const code = error instanceof MuContractSyncError
      ? error.code
      : 'MU_CONTRACT_SYNC_FAILED';
    await database.integrationSyncState.update({
      where: { provider: MU_CONTRACT_PROVIDER },
      data: {
        reconcileStatus: IntegrationReconcileStatus.FAILED,
        lastErrorCode: code,
        lastErrorMessage: `MU Contract reconcile stopped (${code})`,
      },
    });
    if (error instanceof MuContractSyncError) throw error;
    throw new MuContractSyncError('MU_CONTRACT_SYNC_FAILED');
  } finally {
    await releaseMuContractLease(database, leaseOwner);
  }
}
