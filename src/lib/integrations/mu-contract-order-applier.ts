import {
  ExternalCustomerMatchStatus,
  ExternalOrderLinkMode,
  IntegrationConflictStatus,
  IntegrationConflictType,
  Prisma,
} from '@prisma/client';

import type { MuContractOrderEvent } from '@/lib/integrations/mu-contract-contract';
import { MU_CONTRACT_PROVIDER } from '@/lib/integrations/mu-contract-constants';
import {
  resolveMuContractOrderCustomer,
  type MuContractOrderCustomerResolution,
} from '@/lib/integrations/mu-contract-customer-resolver';
import { normalizeOrderIdentifier } from '@/lib/order-name-kernel';
import { serializeOrderTokens } from '@/lib/tokenizer';

export type MuContractConflictType =
  | 'INVALID_SOURCE_DATA'
  | 'ORDER_NO_COLLISION'
  | 'SOURCE_LINK_COLLISION'
  | 'HUMAN_EDITED_RENAME_COLLISION'
  | 'CUSTOMER_MATCH_CONFLICT'
  | 'UNSUPPORTED_CURRENCY';

export type MuContractApplyResult = {
  result: 'APPLIED' | 'IGNORED_STALE' | 'BUSINESS_CONFLICT';
  orderTrackerId: string | null;
  linkMode: 'MANUAL_ATTACHED' | 'SYNC_CREATED' | null;
  conflictType: MuContractConflictType | null;
};

export type MuContractApplyInput = {
  state: MuContractOrderEvent;
  actorId: string;
  cursor: string;
};

type SourceLinkWithOrder = Prisma.ExternalOrderSourceLinkGetPayload<{
  include: { orderTracker: true };
}>;

type TrackerRow = NonNullable<SourceLinkWithOrder['orderTracker']>;

type AppliedTarget = {
  orderTrackerId: string | null;
  linkMode: ExternalOrderLinkMode;
  customerMatchStatus: ExternalCustomerMatchStatus;
  customerConflictEvidence?: unknown;
};

function sourceMetadata(state: MuContractOrderEvent, cursor: string) {
  return {
    sourceVersion: state.source.version,
    sourceOrderNo: state.order.orderNo,
    normalizedSourceOrderNo: normalizeOrderIdentifier(state.order.orderNo),
    piCreatedAt: new Date(state.order.piCreatedAt),
    officialAmount: state.officialAmount?.value ?? null,
    currency: state.officialAmount?.currency ?? null,
    officialGeneratedAt: state.officialAmount
      ? new Date(state.officialAmount.generatedAt)
      : null,
    officialGenerationRunId: state.officialAmount?.generationRunId ?? null,
    active: state.order.active,
    sourceDeletedAt: state.order.deletedAt ? new Date(state.order.deletedAt) : null,
    lastEventCursor: cursor,
    lastSourceUpdatedAt: new Date(state.occurredAt),
  };
}

function customerStatusForTracker(row: Pick<TrackerRow, 'customerId' | 'needsCustomerFix'>) {
  return row.customerId && !row.needsCustomerFix
    ? ExternalCustomerMatchStatus.MATCHED
    : ExternalCustomerMatchStatus.UNMATCHED;
}

function customerFields(resolution: MuContractOrderCustomerResolution) {
  if (resolution.status !== 'MATCHED') {
    return {
      financeOrderId: null,
      customerId: null,
      customerMark: null,
      customerName: null,
      customerPhone: null,
      customerCity: null,
      needsCustomerFix: true,
    };
  }

  return {
    financeOrderId: resolution.orderId,
    customerId: resolution.customerId,
    customerMark: resolution.customer.mark,
    customerName: resolution.customer.orderName || resolution.derivedOrderName,
    customerPhone: resolution.customer.phone,
    customerCity: resolution.customer.city,
    needsCustomerFix: false,
  };
}

function customerMatchStatus(resolution: MuContractOrderCustomerResolution) {
  if (resolution.status === 'MATCHED') return ExternalCustomerMatchStatus.MATCHED;
  if (resolution.status === 'CONFLICT') return ExternalCustomerMatchStatus.CONFLICT;
  return ExternalCustomerMatchStatus.UNMATCHED;
}

async function resolveForNewTracker(
  tx: Prisma.TransactionClient,
  state: MuContractOrderEvent,
  actorId: string,
): Promise<AppliedTarget> {
  const resolution = await resolveMuContractOrderCustomer(tx, state.order.orderNo);
  const row = await tx.orderTracker.create({
    data: {
      orderNo: state.order.orderNo,
      normalizedOrderNo: normalizeOrderIdentifier(state.order.orderNo),
      tokens: serializeOrderTokens(state.order.orderNo),
      amount: 0,
      orderBalance: 0,
      ...customerFields(resolution),
      createdBy: actorId,
      updatedBy: null,
      status: 'In progress',
      confirmedAt: null,
      piStatus: false,
      remark: null,
      systemNote: null,
    },
  });

  return {
    orderTrackerId: row.id,
    linkMode: ExternalOrderLinkMode.SYNC_CREATED,
    customerMatchStatus: customerMatchStatus(resolution),
    customerConflictEvidence: resolution.status === 'CONFLICT'
      ? { code: resolution.code, detail: resolution.detail ?? null }
      : undefined,
  };
}

async function retryUnresolvedCustomer(
  tx: Prisma.TransactionClient,
  row: TrackerRow,
  state: MuContractOrderEvent,
  actorId: string,
): Promise<Pick<AppliedTarget, 'customerMatchStatus' | 'customerConflictEvidence'>> {
  if (!row.needsCustomerFix) {
    return { customerMatchStatus: customerStatusForTracker(row) };
  }

  const resolution = await resolveMuContractOrderCustomer(tx, state.order.orderNo);
  if (resolution.status === 'MATCHED') {
    await tx.orderTracker.update({
      where: { id: row.id },
      data: {
        ...customerFields(resolution),
        updatedBy: actorId,
      },
    });
  }

  return {
    customerMatchStatus: customerMatchStatus(resolution),
    customerConflictEvidence: resolution.status === 'CONFLICT'
      ? { code: resolution.code, detail: resolution.detail ?? null }
      : undefined,
  };
}

async function persistLink(
  tx: Prisma.TransactionClient,
  existing: SourceLinkWithOrder | null,
  state: MuContractOrderEvent,
  cursor: string,
  target: AppliedTarget,
): Promise<void> {
  const data = {
    ...sourceMetadata(state, cursor),
    orderTrackerId: target.orderTrackerId,
    linkMode: target.linkMode,
    customerMatchStatus: target.customerMatchStatus,
  };

  if (existing) {
    await tx.externalOrderSourceLink.update({
      where: { id: existing.id },
      data,
    });
    return;
  }

  await tx.externalOrderSourceLink.create({
    data: {
      provider: MU_CONTRACT_PROVIDER,
      externalId: state.source.piId,
      ...data,
    },
  });
}

const conflictSummary: Record<MuContractConflictType, string> = {
  INVALID_SOURCE_DATA: 'MU Contract source data is invalid',
  ORDER_NO_COLLISION: 'MU Contract ORDER NO collides with an existing manual Orders row',
  SOURCE_LINK_COLLISION: 'Orders row is already linked to another MU Contract PI',
  HUMAN_EDITED_RENAME_COLLISION: 'Human-edited synchronized row cannot be replaced during rename',
  CUSTOMER_MATCH_CONFLICT: 'ORDER NO matches more than one customer',
  UNSUPPORTED_CURRENCY: 'Official PI amount uses an unsupported currency',
};

async function recordConflict(
  tx: Prisma.TransactionClient,
  input: MuContractApplyInput,
  type: MuContractConflictType,
  targetOrderTrackerIds: string[],
  evidence: Prisma.InputJsonValue,
): Promise<void> {
  const dedupeKey = `${MU_CONTRACT_PROVIDER}:${input.state.source.piId}:${type}`;
  const shared = {
    provider: MU_CONTRACT_PROVIDER,
    sourcePiId: input.state.source.piId,
    sourceVersion: input.state.source.version,
    eventId: input.state.eventId,
    cursor: input.cursor,
    type: type as IntegrationConflictType,
    sourceOrderNo: input.state.order.orderNo,
    targetOrderTrackerIds,
    summary: conflictSummary[type],
    evidence,
    status: IntegrationConflictStatus.OPEN,
    resolutionNote: null,
    resolvedAt: null,
    resolvedBy: null,
  };

  await tx.integrationSyncConflict.upsert({
    where: { dedupeKey },
    create: { dedupeKey, ...shared },
    update: shared,
  });
}

async function resolveOtherConflicts(
  tx: Prisma.TransactionClient,
  sourcePiId: string,
  actorId: string,
  openTypes: MuContractConflictType[],
): Promise<void> {
  await tx.integrationSyncConflict.updateMany({
    where: {
      provider: MU_CONTRACT_PROVIDER,
      sourcePiId,
      status: IntegrationConflictStatus.OPEN,
      ...(openTypes.length > 0
        ? { type: { notIn: openTypes as IntegrationConflictType[] } }
        : {}),
    },
    data: {
      status: IntegrationConflictStatus.RESOLVED,
      resolutionNote: 'Underlying synchronization conflict no longer applies',
      resolvedAt: new Date(),
      resolvedBy: actorId,
    },
  });
}

async function linkedElsewhere(
  tx: Prisma.TransactionClient,
  orderTrackerId: string,
  sourcePiId: string,
) {
  const link = await tx.externalOrderSourceLink.findFirst({
    where: { provider: MU_CONTRACT_PROVIDER, orderTrackerId },
    select: { id: true, externalId: true, orderTrackerId: true },
  });
  return link && link.externalId !== sourcePiId ? link : null;
}

async function createOrAttachTarget(
  tx: Prisma.TransactionClient,
  existing: SourceLinkWithOrder | null,
  state: MuContractOrderEvent,
  actorId: string,
): Promise<{ target: AppliedTarget; collisionIds: string[] }> {
  const normalizedOrderNo = normalizeOrderIdentifier(state.order.orderNo);
  const row = await tx.orderTracker.findUnique({ where: { normalizedOrderNo } });

  if (!row) {
    return { target: await resolveForNewTracker(tx, state, actorId), collisionIds: [] };
  }

  const foreignLink = await linkedElsewhere(tx, row.id, state.source.piId);
  if (foreignLink) {
    return {
      target: {
        orderTrackerId: existing?.orderTrackerId ?? null,
        linkMode: existing?.linkMode ?? ExternalOrderLinkMode.SYNC_CREATED,
        customerMatchStatus: ExternalCustomerMatchStatus.CONFLICT,
      },
      collisionIds: [row.id],
    };
  }

  return {
    target: {
      orderTrackerId: row.id,
      linkMode: ExternalOrderLinkMode.MANUAL_ATTACHED,
      customerMatchStatus: customerStatusForTracker(row),
    },
    collisionIds: [],
  };
}

async function applyExistingLinkedOrder(
  tx: Prisma.TransactionClient,
  existing: SourceLinkWithOrder,
  state: MuContractOrderEvent,
  actorId: string,
): Promise<{
  target: AppliedTarget;
  collisionType: MuContractConflictType | null;
  collisionIds: string[];
}> {
  const current = existing.orderTracker;
  if (!current) {
    const unresolved = await createOrAttachTarget(tx, existing, state, actorId);
    return {
      target: unresolved.target,
      collisionType: unresolved.collisionIds.length > 0 ? 'SOURCE_LINK_COLLISION' : null,
      collisionIds: unresolved.collisionIds,
    };
  }

  if (!state.order.active) {
    return {
      target: {
        orderTrackerId: current.id,
        linkMode: existing.linkMode,
        customerMatchStatus: existing.customerMatchStatus,
      },
      collisionType: null,
      collisionIds: [],
    };
  }

  const normalizedOrderNo = normalizeOrderIdentifier(state.order.orderNo);
  const targetRow = await tx.orderTracker.findUnique({ where: { normalizedOrderNo } });
  if (targetRow && targetRow.id !== current.id) {
    const foreignLink = await linkedElsewhere(tx, targetRow.id, state.source.piId);
    if (foreignLink) {
      return {
        target: {
          orderTrackerId: current.id,
          linkMode: existing.linkMode,
          customerMatchStatus: ExternalCustomerMatchStatus.CONFLICT,
        },
        collisionType: 'SOURCE_LINK_COLLISION',
        collisionIds: [current.id, targetRow.id],
      };
    }

    if (
      existing.linkMode === ExternalOrderLinkMode.SYNC_CREATED
      && existing.humanEditedAt === null
    ) {
      await tx.orderTracker.update({
        where: { id: current.id },
        data: {
          archivedAt: new Date(),
          archiveReason: `MU_CONTRACT rename transferred source ${state.source.piId} to manual row ${targetRow.id}`,
          updatedBy: actorId,
        },
      });
      return {
        target: {
          orderTrackerId: targetRow.id,
          linkMode: ExternalOrderLinkMode.MANUAL_ATTACHED,
          customerMatchStatus: customerStatusForTracker(targetRow),
        },
        collisionType: null,
        collisionIds: [],
      };
    }

    return {
      target: {
        orderTrackerId: current.id,
        linkMode: existing.linkMode,
        customerMatchStatus: ExternalCustomerMatchStatus.CONFLICT,
      },
      collisionType: existing.humanEditedAt
        ? 'HUMAN_EDITED_RENAME_COLLISION'
        : 'ORDER_NO_COLLISION',
      collisionIds: [current.id, targetRow.id],
    };
  }

  if (current.orderNo !== state.order.orderNo) {
    await tx.orderTracker.update({
      where: { id: current.id },
      data: {
        orderNo: state.order.orderNo,
        normalizedOrderNo,
        tokens: serializeOrderTokens(state.order.orderNo),
        updatedBy: actorId,
      },
    });
  }

  const customer = await retryUnresolvedCustomer(tx, current, state, actorId);
  return {
    target: {
      orderTrackerId: current.id,
      linkMode: existing.linkMode,
      ...customer,
    },
    collisionType: null,
    collisionIds: [],
  };
}

export async function applyMuContractOrderState(
  tx: Prisma.TransactionClient,
  input: MuContractApplyInput,
): Promise<MuContractApplyResult> {
  const { state, actorId, cursor } = input;
  const existing = await tx.externalOrderSourceLink.findUnique({
    where: {
      provider_externalId: {
          provider: MU_CONTRACT_PROVIDER,
        externalId: state.source.piId,
      },
    },
    include: { orderTracker: true },
  });

  if (existing && state.source.version < existing.sourceVersion) {
    return {
      result: 'IGNORED_STALE',
      orderTrackerId: existing.orderTrackerId,
      linkMode: existing.linkMode,
      conflictType: null,
    };
  }

  let target: AppliedTarget;
  let collisionType: MuContractConflictType | null = null;
  let collisionIds: string[] = [];

  if (existing) {
    const applied = await applyExistingLinkedOrder(tx, existing, state, actorId);
    target = applied.target;
    collisionType = applied.collisionType;
    collisionIds = applied.collisionIds;
  } else {
    const applied = await createOrAttachTarget(tx, null, state, actorId);
    target = applied.target;
    collisionType = applied.collisionIds.length > 0 ? 'SOURCE_LINK_COLLISION' : null;
    collisionIds = applied.collisionIds;
  }

  await persistLink(tx, existing, state, cursor, target);

  const conflicts: Array<{ type: MuContractConflictType; ids: string[]; evidence: Prisma.InputJsonValue }> = [];
  if (collisionType) {
    conflicts.push({
      type: collisionType,
      ids: collisionIds,
      evidence: {
        sourcePiId: state.source.piId,
        currentOrderTrackerId: existing?.orderTrackerId ?? null,
        targetOrderTrackerIds: collisionIds,
      },
    });
  }
  if (target.customerConflictEvidence) {
    conflicts.push({
      type: 'CUSTOMER_MATCH_CONFLICT',
      ids: target.orderTrackerId ? [target.orderTrackerId] : [],
      evidence: target.customerConflictEvidence as Prisma.InputJsonValue,
    });
  }
  if (state.officialAmount && state.officialAmount.currency !== 'USD') {
    conflicts.push({
      type: 'UNSUPPORTED_CURRENCY',
      ids: target.orderTrackerId ? [target.orderTrackerId] : [],
      evidence: {
        currency: state.officialAmount.currency,
        amount: state.officialAmount.value,
      },
    });
  }

  await resolveOtherConflicts(
    tx,
    state.source.piId,
    actorId,
    conflicts.map((item) => item.type),
  );
  for (const conflict of conflicts) {
    await recordConflict(tx, input, conflict.type, conflict.ids, conflict.evidence);
  }

  return {
    result: conflicts.length > 0 ? 'BUSINESS_CONFLICT' : 'APPLIED',
    orderTrackerId: target.orderTrackerId,
    linkMode: target.linkMode,
    conflictType: conflicts[0]?.type ?? null,
  };
}
