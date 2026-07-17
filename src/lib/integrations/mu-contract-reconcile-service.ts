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

type ReconcileTargetState = {
  byPi: Record<string, string>;
  manualOnlyHash: string;
};

type StoredSnapshotSummary = MuContractReconcileSummary & {
  _targetState: ReconcileTargetState;
};

type ReconcileAnalysis = {
  summary: MuContractReconcileSummary;
  targetState: ReconcileTargetState;
};

function databaseFrom(value?: object): typeof db {
  return (value ?? db) as typeof db;
}

function clockFrom(value?: () => Date): () => Date {
  return value ?? (() => new Date());
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function hashCanonical(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function reconcileFingerprint(
  items: MuContractSnapshotItem[],
  highWatermark: string,
  summary: MuContractReconcileSummary,
  targetState: ReconcileTargetState,
): string {
  return hashCanonical({ highWatermark, items, summary, targetState });
}

async function readSnapshot(
  client: MuContractClient,
  batchSize: number,
  afterPage?: () => Promise<void>,
) {
  const items: MuContractSnapshotItem[] = [];
  const seenPiIds = new Set<string>();
  const seenPageCursors = new Set<string>();
  let after: string | null = null;
  let highWatermark: string | null = null;
  let previousPiId: string | null = null;
  let hasMore = true;

  while (hasMore) {
    const page = await client.fetchSnapshot(after, batchSize);
    await afterPage?.();
    if (highWatermark !== null && page.eventHighWatermark !== highWatermark) {
      throw new MuContractSyncError('MU_CONTRACT_RECONCILE_SOURCE_CHANGED');
    }
    highWatermark ??= page.eventHighWatermark;

    for (const item of page.items) {
      const piId = item.source.piId;
      if (seenPiIds.has(piId) || (previousPiId !== null && piId.localeCompare(previousPiId) <= 0)) {
        throw new MuContractSyncError('MU_CONTRACT_CURSOR_INVALID');
      }
      seenPiIds.add(piId);
      previousPiId = piId;
      items.push(item);
    }

    hasMore = page.hasMore;
    if (hasMore) {
      const expectedCursor = page.items.at(-1)?.source.piId ?? null;
      if (
        !page.nextAfter
        || page.nextAfter !== expectedCursor
        || page.nextAfter === after
        || seenPageCursors.has(page.nextAfter)
      ) {
        throw new MuContractSyncError('MU_CONTRACT_CURSOR_INVALID');
      }
      seenPageCursors.add(page.nextAfter);
    }
    after = page.nextAfter;
  }

  return { items, highWatermark: highWatermark ?? '0' };
}

function trackerEvidence(row: Record<string, unknown> | null | undefined) {
  if (!row) return null;
  const sourceLinks = Array.isArray(row.externalSourceLinks)
    ? row.externalSourceLinks as Array<Record<string, unknown>>
    : [];
  return {
    id: row.id ?? null,
    orderNo: row.orderNo ?? null,
    normalizedOrderNo: row.normalizedOrderNo ?? null,
    financeOrderId: row.financeOrderId ?? null,
    customerId: row.customerId ?? null,
    customerMark: row.customerMark ?? null,
    customerName: row.customerName ?? null,
    customerPhone: row.customerPhone ?? null,
    customerCity: row.customerCity ?? null,
    needsCustomerFix: row.needsCustomerFix === true,
    status: row.status ?? null,
    confirmedAt: row.confirmedAt ?? null,
    piStatus: row.piStatus ?? null,
    remark: row.remark ?? null,
    systemNote: row.systemNote ?? null,
    archivedAt: row.archivedAt ?? null,
    sourceExternalIds: sourceLinks
      .map((link) => String(link.externalId ?? ''))
      .filter(Boolean)
      .sort(),
  };
}

function linkEvidence(link: Record<string, unknown> | null | undefined) {
  if (!link) return null;
  return {
    id: link.id ?? null,
    externalId: link.externalId ?? null,
    orderTrackerId: link.orderTrackerId ?? null,
    sourceVersion: link.sourceVersion ?? null,
    linkMode: link.linkMode ?? null,
    active: link.active ?? null,
    humanEditedAt: link.humanEditedAt ?? null,
    customerMatchStatus: link.customerMatchStatus ?? null,
    orderTracker: trackerEvidence(
      link.orderTracker && typeof link.orderTracker === 'object'
        ? link.orderTracker as Record<string, unknown>
        : null,
    ),
  };
}

async function buildPreviewAnalysis(
  database: typeof db,
  items: MuContractSnapshotItem[],
): Promise<ReconcileAnalysis> {
  const [links, trackers] = await Promise.all([
    database.externalOrderSourceLink.findMany({
      where: { provider: MU_CONTRACT_PROVIDER },
      include: { orderTracker: true },
    }),
    database.orderTracker.findMany({
      where: { archivedAt: null },
      select: {
        id: true,
        orderNo: true,
        normalizedOrderNo: true,
        financeOrderId: true,
        customerId: true,
        customerMark: true,
        customerName: true,
        customerPhone: true,
        customerCity: true,
        needsCustomerFix: true,
        status: true,
        confirmedAt: true,
        piStatus: true,
        remark: true,
        systemNote: true,
        archivedAt: true,
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
  const targetByPi: Record<string, string> = {};

  for (const item of items) {
    const normalized = normalizeOrderIdentifier(item.order.orderNo);
    const link = linksByPi.get(item.source.piId);
    const tracker = trackersByOrder.get(normalized);
    const duplicateCount = sourceOrderCounts.get(normalized) ?? 0;
    let resolutionEvidence: Record<string, unknown> | null = null;
    if (!item.order.active) summary.inactive += 1;

    if (duplicateCount > 1) {
      summary.conflicts += 1;
    } else if (link) {
      if (item.source.version >= link.sourceVersion) summary.updates += 1;
      if (link.customerMatchStatus !== 'MATCHED') summary.unmatched += 1;
    } else if (tracker) {
      if (tracker.externalSourceLinks.length > 0) {
        summary.conflicts += 1;
      } else {
        summary.metadataOnly += 1;
        if (!tracker.customerId || tracker.needsCustomerFix) summary.unmatched += 1;
      }
    } else {
      summary.creates += 1;
      const customer = await resolveMuContractOrderCustomer(database, item.order.orderNo);
      resolutionEvidence = {
        status: customer.status,
        customerId: 'customerId' in customer ? customer.customerId : null,
        orderId: 'orderId' in customer ? customer.orderId : null,
        code: 'code' in customer ? customer.code : null,
        customer: customer.status === 'MATCHED'
          ? {
              mark: customer.customer.mark,
              orderName: customer.customer.orderName,
              phone: customer.customer.phone,
              city: customer.customer.city,
            }
          : null,
      };
      if (customer.status !== 'MATCHED') summary.unmatched += 1;
      if (customer.status === 'CONFLICT') summary.conflicts += 1;
    }

    targetByPi[item.source.piId] = hashCanonical({
      duplicateCount,
      link: linkEvidence(link as unknown as Record<string, unknown> | undefined),
      target: trackerEvidence(tracker as unknown as Record<string, unknown> | undefined),
      resolution: resolutionEvidence,
    });
  }

  const sourceOrders = new Set(items.map((item) => normalizeOrderIdentifier(item.order.orderNo)));
  const manualOnlyIds = trackers.filter((row) => (
    row.externalSourceLinks.length === 0 && !sourceOrders.has(row.normalizedOrderNo)
  )).map((row) => row.id).sort();
  summary.manualOnlyUntouched = manualOnlyIds.length;

  return {
    summary,
    targetState: {
      byPi: targetByPi,
      manualOnlyHash: hashCanonical(manualOnlyIds),
    },
  };
}

function storedSummary(value: Prisma.JsonValue): StoredSnapshotSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const target = row._targetState;
  if (!target || typeof target !== 'object' || Array.isArray(target)) return null;
  const targetRow = target as Record<string, unknown>;
  if (!targetRow.byPi || typeof targetRow.byPi !== 'object' || typeof targetRow.manualOnlyHash !== 'string') {
    return null;
  }
  return row as StoredSnapshotSummary;
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
  const analysis = await buildPreviewAnalysis(database, snapshot.items);
  const createdAt = now();
  const expiresAt = new Date(createdAt.getTime() + PREVIEW_TTL_MS);
  const stored: StoredSnapshotSummary = {
    ...analysis.summary,
    _targetState: analysis.targetState,
  };
  const preview = await database.integrationReconcilePreview.create({
    data: {
      provider: MU_CONTRACT_PROVIDER,
      sourceHighWatermark: snapshot.highWatermark,
      snapshotSummary: stored as unknown as Prisma.InputJsonValue,
      summaryHash: reconcileFingerprint(
        snapshot.items,
        snapshot.highWatermark,
        analysis.summary,
        analysis.targetState,
      ),
      createdBy: actorId,
      createdAt,
      expiresAt,
    },
  });

  return {
    previewId: preview.id,
    expiresAt: expiresAt.toISOString(),
    highWatermark: snapshot.highWatermark,
    summary: analysis.summary,
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

function assertResumeTargetState(
  items: MuContractSnapshotItem[],
  cursor: string,
  stored: ReconcileTargetState,
  current: ReconcileTargetState,
): number {
  const cursorIndex = items.findIndex((item) => item.source.piId === cursor);
  if (cursorIndex < 0 || current.manualOnlyHash !== stored.manualOnlyHash) {
    throw new MuContractSyncError('MU_CONTRACT_RECONCILE_SOURCE_CHANGED');
  }
  for (const item of items.slice(cursorIndex + 1)) {
    if (current.byPi[item.source.piId] !== stored.byPi[item.source.piId]) {
      throw new MuContractSyncError('MU_CONTRACT_RECONCILE_SOURCE_CHANGED');
    }
  }
  return cursorIndex + 1;
}

async function guardedStateUpdate(
  database: typeof db,
  leaseOwner: string,
  data: Prisma.IntegrationSyncStateUpdateManyMutationInput,
): Promise<void> {
  const updated = await database.integrationSyncState.updateMany({
    where: { provider: MU_CONTRACT_PROVIDER, leaseOwner },
    data,
  });
  if (updated.count !== 1) throw new MuContractSyncError('MU_CONTRACT_LEASE_LOST');
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
  const preview = await database.integrationReconcilePreview.findUnique({ where: { id: previewId } });
  assertPreviewUsable(preview, actorId, now());

  await ensureMuContractSyncState(database, actorId);
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

  let processed = 0;
  let conflicts = 0;
  try {
    const [state, snapshot] = await Promise.all([
      database.integrationSyncState.findUnique({ where: { provider: MU_CONTRACT_PROVIDER } }),
      readSnapshot(
        client,
        settings.batchSize,
        () => renewMuContractLease(database, leaseOwner, now()),
      ),
    ]);
    if (!state || snapshot.highWatermark !== preview.sourceHighWatermark) {
      throw new MuContractSyncError('MU_CONTRACT_RECONCILE_SOURCE_CHANGED');
    }
    const stored = storedSummary(preview.snapshotSummary);
    if (!stored) throw new MuContractSyncError('MU_CONTRACT_RECONCILE_SOURCE_CHANGED');
    const { _targetState: storedTargetState, ...approvedSummary } = stored;
    const approvedSourceFingerprint = reconcileFingerprint(
      snapshot.items,
      snapshot.highWatermark,
      approvedSummary,
      storedTargetState,
    );
    if (approvedSourceFingerprint !== preview.summaryHash) {
      throw new MuContractSyncError('MU_CONTRACT_RECONCILE_SOURCE_CHANGED');
    }

    const current = await buildPreviewAnalysis(database, snapshot.items);
    const canResume = state.reconcileHighWatermark === preview.sourceHighWatermark
      && state.reconcileCursor !== null;
    const startIndex = canResume
      ? assertResumeTargetState(
          snapshot.items,
          state.reconcileCursor as string,
          storedTargetState,
          current.targetState,
        )
      : 0;
    if (!canResume && reconcileFingerprint(
      snapshot.items,
      snapshot.highWatermark,
      current.summary,
      current.targetState,
    ) !== preview.summaryHash) {
      throw new MuContractSyncError('MU_CONTRACT_RECONCILE_SOURCE_CHANGED');
    }

    await guardedStateUpdate(database, leaseOwner, {
      reconcileStatus: IntegrationReconcileStatus.RUNNING,
      reconcileCursor: canResume ? state.reconcileCursor : null,
      reconcileHighWatermark: preview.sourceHighWatermark,
      lastErrorCode: null,
      lastErrorMessage: null,
    });

    for (let index = startIndex; index < snapshot.items.length; index += settings.batchSize) {
      const chunk = snapshot.items.slice(index, index + settings.batchSize);
      const chunkResults = await database.$transaction(async (tx) => {
        const transactionStartedAt = now();
        const lease = await tx.integrationSyncState.updateMany({
          where: {
            provider: MU_CONTRACT_PROVIDER,
            leaseOwner,
            leaseExpiresAt: { gt: transactionStartedAt },
          },
          data: { leaseExpiresAt: new Date(transactionStartedAt.getTime() + MU_CONTRACT_LEASE_MS) },
        });
        if (lease.count !== 1) throw new MuContractSyncError('MU_CONTRACT_LEASE_LOST');

        const results = [];
        for (const item of chunk) {
          results.push(await applyMuContractOrderState(tx, {
            state: snapshotEvent(item, preview.sourceHighWatermark),
            actorId,
            cursor: preview.sourceHighWatermark,
          }));
        }
        const checkpoint = await tx.integrationSyncState.updateMany({
          where: { provider: MU_CONTRACT_PROVIDER, leaseOwner },
          data: {
            reconcileStatus: IntegrationReconcileStatus.RUNNING,
            reconcileCursor: chunk.at(-1)?.source.piId ?? null,
            reconcileHighWatermark: preview.sourceHighWatermark,
          },
        });
        if (checkpoint.count !== 1) throw new MuContractSyncError('MU_CONTRACT_LEASE_LOST');
        return results;
      });
      processed += chunkResults.length;
      conflicts += chunkResults.filter((result) => result.result === 'BUSINESS_CONFLICT').length;
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
        data: { leaseExpiresAt: new Date(completedAt.getTime() + MU_CONTRACT_LEASE_MS) },
      });
      if (lease.count !== 1) throw new MuContractSyncError('MU_CONTRACT_LEASE_LOST');
      const completed = await tx.integrationSyncState.updateMany({
        where: { provider: MU_CONTRACT_PROVIDER, leaseOwner },
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
      if (completed.count !== 1) throw new MuContractSyncError('MU_CONTRACT_LEASE_LOST');
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
    const code = error instanceof MuContractSyncError ? error.code : 'MU_CONTRACT_SYNC_FAILED';
    await database.integrationSyncState.updateMany({
      where: { provider: MU_CONTRACT_PROVIDER, leaseOwner },
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
