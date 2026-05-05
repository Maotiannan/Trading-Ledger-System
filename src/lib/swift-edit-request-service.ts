import { Prisma, SwiftEditRequestStatus, UserRole } from '@prisma/client';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { createApiError } from '@/lib/api-error';
import { db } from '@/lib/db';
import { buildSwiftVisibilityWhere } from '@/lib/resource-visibility';
import type { CurrentUser } from '@/lib/request-auth';
import type { SwiftEditablePatch, SwiftEditRequestRow } from '@/lib/swift-edit-types';
import { runInTransaction } from '@/lib/transaction';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { updateSwiftRecord } from '@/lib/swift-service';

type SwiftSnapshotSource = Partial<Record<keyof SwiftEditablePatch, unknown>> | null | undefined;

function apiError(code: string, status: number, message: string, detail?: unknown) {
  return createApiError({
    code: code as never,
    status,
    message,
    detail,
  });
}

function badRequest(message: string, detail?: unknown) {
  return apiError('BAD_REQUEST', 400, message, detail);
}

function forbidden(code: string, message: string, detail?: unknown) {
  return apiError(code, 403, message, detail);
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    ? error.code === 'P2002'
    : Boolean(
      error
      && typeof error === 'object'
      && 'code' in error
      && (error as { code?: string }).code === 'P2002'
    );
}

function parseEditableDateValue(date: string | null | undefined): Date | null {
  if (date == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw badRequest('SWIFT日期格式无效', { date });
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw badRequest('SWIFT日期格式无效', { date });
  }
  return parsed;
}

function assertEditableSwiftStatus(status: string, detail?: unknown) {
  if (status === 'RECEIVED') {
    throw badRequest('RECEIVED状态下禁止修改SWIFT', detail);
  }
}

function normalizeSwiftSnapshot(input: SwiftSnapshotSource): SwiftEditablePatch {
  const amount = typeof input?.amount === 'number' ? input.amount : Number(input?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw badRequest('SWIFT金额无效', { amount: input?.amount });
  }

  return {
    date: typeof input?.date === 'string' ? input.date : null,
    amount,
    senderName: typeof input?.senderName === 'string' ? input.senderName : null,
    senderAddress: typeof input?.senderAddress === 'string' ? input.senderAddress : null,
    receiverName: typeof input?.receiverName === 'string' ? input.receiverName : null,
    receiverAccount: typeof input?.receiverAccount === 'string' ? input.receiverAccount : null,
  };
}

function validateSwiftPatch(input: SwiftEditablePatch): SwiftEditablePatch {
  const normalized = normalizeSwiftSnapshot(input as SwiftSnapshotSource);
  parseEditableDateValue(normalized.date);
  return normalized;
}

function buildScopedSwiftWhere(swiftId: string, ownerIds: string[]): Prisma.SwiftWhereInput {
  return {
    AND: [
      { id: swiftId },
      buildSwiftVisibilityWhere(ownerIds),
    ],
  };
}

function toReviewDecisionMessage(decision: 'approve' | 'reject') {
  return decision === 'approve' ? 'SWIFT修改申请已通过' : 'SWIFT修改申请已拒绝';
}

function mapSwiftEditRequestRow(row: {
  id: string;
  swiftId: string;
  status: SwiftEditRequestStatus;
  requestedBy: string;
  approvedBy: string | null;
  requestedAt: Date;
  reviewedAt: Date | null;
  beforeSnapshot: Prisma.JsonValue;
  afterSnapshot: Prisma.JsonValue;
  reviewComment: string | null;
  requester: { name: string | null; email: string | null };
  approver: { name: string | null; email: string | null } | null;
}): SwiftEditRequestRow {
  return {
    id: row.id,
    swiftId: row.swiftId,
    status: row.status,
    requestedBy: row.requestedBy,
    requestedByName: row.requester.name || row.requester.email || row.requestedBy,
    approvedBy: row.approvedBy,
    approvedByName: row.approver
      ? (row.approver.name || row.approver.email || row.approvedBy)
      : null,
    requestedAt: row.requestedAt.toISOString(),
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    beforeSnapshot: normalizeSwiftSnapshot(row.beforeSnapshot as SwiftSnapshotSource),
    afterSnapshot: normalizeSwiftSnapshot(row.afterSnapshot as SwiftSnapshotSource),
    reviewComment: row.reviewComment,
  };
}

async function buildSwiftEditRequestWhere(currentUser: CurrentUser): Promise<Prisma.SwiftEditRequestWhereInput> {
  const scope = await getHierarchyScope(currentUser);
  const ownerIds = Array.from(scope.ownerVisibleIds);
  const swiftVisibilityWhere = buildSwiftVisibilityWhere(ownerIds);

  if (currentUser.role === UserRole.SALES) {
    return {
      AND: [
        { requestedBy: currentUser.id },
        { swift: swiftVisibilityWhere },
      ],
    };
  }

  const descendantIds = Array.from(scope.descendantIds);
  const visibleRequesterIds = Array.from(scope.visibleIds);
  const branches: Prisma.SwiftEditRequestWhereInput[] = [];

  if (descendantIds.length > 0) {
    branches.push({
      AND: [
        { status: SwiftEditRequestStatus.PENDING },
        { requestedBy: { in: descendantIds } },
        { swift: swiftVisibilityWhere },
      ],
    });
  }

  if (visibleRequesterIds.length > 0) {
    branches.push({
      AND: [
        { status: { in: [SwiftEditRequestStatus.APPROVED, SwiftEditRequestStatus.REJECTED] } },
        { requestedBy: { in: visibleRequesterIds } },
        { swift: swiftVisibilityWhere },
      ],
    });
  }

  return branches.length === 1 ? branches[0] : { OR: branches };
}

export async function requestSwiftEdit(params: {
  currentUser: CurrentUser;
  swiftId: string;
  data: SwiftEditablePatch;
}) {
  const { currentUser, swiftId } = params;
  const afterSnapshot = validateSwiftPatch(params.data);

  if (currentUser.role !== UserRole.SALES) {
    throw forbidden('SWIFT_EDIT_REQUEST_FORBIDDEN', '只有销售可以提交SWIFT修改申请', {
      role: currentUser.role,
      swiftId,
    });
  }
  if (!swiftId) {
    throw badRequest('缺少SWIFT ID');
  }

  const scope = await getHierarchyScope(currentUser);
  const ownerIds = Array.from(scope.ownerVisibleIds);

  try {
    const request = await runInTransaction(async (tx) => {
      const swift = await tx.swift.findFirst({
        where: buildScopedSwiftWhere(swiftId, ownerIds),
        select: {
          id: true,
          createdBy: true,
          status: true,
          date: true,
          amount: true,
          senderName: true,
          senderAddress: true,
          receiverName: true,
          receiverAccount: true,
        },
      });

      if (!swift) {
        throw forbidden('SWIFT_EDIT_REQUEST_FORBIDDEN', '无权申请修改该SWIFT', {
          swiftId,
          ownerIds,
        });
      }

      assertEditableSwiftStatus(swift.status, { swiftId, status: swift.status });

      const existingPending = await tx.swiftEditRequest.findFirst({
        where: {
          pendingSwiftId: swiftId,
          status: SwiftEditRequestStatus.PENDING,
        },
        select: { id: true },
      });
      if (existingPending) {
        throw apiError('SWIFT_EDIT_REQUEST_EXISTS', 409, '该SWIFT已有待审批的修改申请', {
          swiftId,
          requestId: existingPending.id,
        });
      }

      const beforeSnapshot: SwiftEditablePatch = {
        date: swift.date instanceof Date ? swift.date.toISOString().slice(0, 10) : null,
        amount: Number(swift.amount),
        senderName: swift.senderName,
        senderAddress: swift.senderAddress,
        receiverName: swift.receiverName,
        receiverAccount: swift.receiverAccount,
      };

      return tx.swiftEditRequest.create({
        data: {
          swiftId,
          requestedBy: currentUser.id,
          pendingSwiftId: swiftId,
          status: SwiftEditRequestStatus.PENDING,
          beforeSnapshot,
          afterSnapshot,
        },
      });
    });

    await recordAuditEvent({
      action: auditActions.SWIFT_EDIT_REQUEST_CREATE,
      actorId: currentUser.id,
      targetType: auditTargetTypes.SWIFT_EDIT_REQUEST,
      targetId: request.id,
      metadata: {
        swiftId,
        pendingSwiftId: swiftId,
        afterSnapshot,
      },
    });

    return {
      data: request,
      message: 'SWIFT修改申请已提交，等待管理员同意',
    };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw apiError('SWIFT_EDIT_REQUEST_EXISTS', 409, '该SWIFT已有待审批的修改申请', {
        swiftId,
      });
    }
    throw error;
  }
}

export async function reviewSwiftEdit(params: {
  currentUser: CurrentUser;
  requestId: string;
  decision: 'approve' | 'reject';
  comment?: string | null;
}) {
  const { currentUser, requestId, decision, comment } = params;

  if (currentUser.role !== UserRole.ADMIN) {
    throw forbidden('SWIFT_EDIT_REVIEW_FORBIDDEN', '只有管理员可以审批SWIFT修改申请', {
      role: currentUser.role,
      requestId,
    });
  }
  if (!requestId) {
    throw badRequest('缺少申请ID');
  }

  const scope = await getHierarchyScope(currentUser);
  const descendantIds = scope.descendantIds;
  const ownerIds = Array.from(scope.ownerVisibleIds);

  await runInTransaction(async (tx) => {
    const request = await tx.swiftEditRequest.findUnique({
      where: { id: requestId },
      include: {
        swift: true,
        requester: true,
      },
    });

    if (!request) {
      throw apiError('RESOURCE_NOT_FOUND', 400, '申请不存在', { requestId });
    }
    if (request.status !== SwiftEditRequestStatus.PENDING) {
      throw apiError('SWIFT_EDIT_REQUEST_ALREADY_PROCESSED', 400, '该申请已处理', {
        requestId,
        status: request.status,
      });
    }
    if (request.requestedBy === currentUser.id) {
      throw forbidden('SWIFT_EDIT_REVIEW_FORBIDDEN', '不能审批自己提交的SWIFT修改申请', {
        requestId,
        requestedBy: request.requestedBy,
      });
    }
    if (!descendantIds.has(request.requestedBy)) {
      throw forbidden('SWIFT_EDIT_REVIEW_FORBIDDEN', '无权审批该SWIFT修改申请', {
        requestId,
        requestedBy: request.requestedBy,
      });
    }

    const visibleSwift = await tx.swift.findFirst({
      where: buildScopedSwiftWhere(request.swiftId, ownerIds),
      select: { id: true, status: true },
    });
    if (!visibleSwift) {
      throw forbidden('SWIFT_EDIT_REVIEW_FORBIDDEN', '无权审批该SWIFT修改申请', {
        requestId,
        swiftId: request.swiftId,
      });
    }

    assertEditableSwiftStatus(visibleSwift.status, { swiftId: request.swiftId, status: visibleSwift.status });

    const nextSnapshot = validateSwiftPatch(request.afterSnapshot as SwiftSnapshotSource as SwiftEditablePatch);
    const reviewedAt = new Date();
    const claimResult = await tx.swiftEditRequest.updateMany({
      where: {
        id: requestId,
        status: SwiftEditRequestStatus.PENDING,
        pendingSwiftId: request.swiftId,
      },
      data: {
        status: decision === 'approve' ? SwiftEditRequestStatus.APPROVED : SwiftEditRequestStatus.REJECTED,
        approvedBy: currentUser.id,
        reviewComment: comment ?? null,
        reviewedAt,
        pendingSwiftId: null,
      },
    });

    if (claimResult.count !== 1) {
      throw apiError('SWIFT_EDIT_REQUEST_ALREADY_PROCESSED', 400, '该申请已处理', { requestId });
    }

    if (decision === 'approve') {
      await updateSwiftRecord({
        currentUser,
        swiftId: request.swiftId,
        payload: nextSnapshot,
        txClient: tx,
        skipAudit: true,
      });
    }
  });

  await recordAuditEvent({
    action: decision === 'approve'
      ? auditActions.SWIFT_EDIT_REQUEST_APPROVE
      : auditActions.SWIFT_EDIT_REQUEST_REJECT,
    actorId: currentUser.id,
    targetType: auditTargetTypes.SWIFT_EDIT_REQUEST,
    targetId: requestId,
    metadata: {
      decision,
      comment: comment ?? null,
    },
  });

  return { message: toReviewDecisionMessage(decision) };
}

export async function listSwiftEditRequests(currentUser: CurrentUser): Promise<SwiftEditRequestRow[]> {
  const where = await buildSwiftEditRequestWhere(currentUser);
  const rows = await db.swiftEditRequest.findMany({
    where,
    include: {
      requester: {
        select: {
          name: true,
          email: true,
        },
      },
      approver: {
        select: {
          name: true,
          email: true,
        },
      },
    },
    orderBy: [
      { requestedAt: 'desc' },
      { createdAt: 'desc' },
    ],
  });

  return rows.map(mapSwiftEditRequestRow);
}
