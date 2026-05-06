import { DetailEditRequestStatus, Prisma, UserRole } from '@prisma/client';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { createApiError } from '@/lib/api-error';
import { db } from '@/lib/db';
import type { DetailEditableItemPatch, DetailEditablePatch, DetailEditRequestRow } from '@/lib/detail-edit-types';
import { buildDetailVisibilityWhere } from '@/lib/resource-visibility';
import type { CurrentUser } from '@/lib/request-auth';
import { runInTransaction } from '@/lib/transaction';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { updateDetailRecord } from '@/lib/detail-service';

type DetailSnapshotSource = {
  date?: unknown;
  agentId?: unknown;
  items?: unknown;
} | null | undefined;

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
    throw badRequest('付款明细日期格式无效', { date });
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw badRequest('付款明细日期格式无效', { date });
  }
  return parsed;
}

function assertEditableDetailStatus(status: string, detail?: unknown) {
  if (status === 'RECEIVED') {
    throw badRequest('RECEIVED状态下禁止修改付款明细', detail);
  }
  if (status === 'Bank_Transfer') {
    throw badRequest('Bank_Transfer状态下禁止修改付款明细', detail);
  }
}

function normalizeDetailItems(items: unknown): DetailEditableItemPatch[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw badRequest('未识别到有效明细项');
  }

  return items.map((item, index) => {
    const row = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const amount = typeof row.amount === 'number' ? row.amount : Number(row.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw badRequest('明细金额必须大于 0', { index, amount: row.amount });
    }
    return {
      mark: typeof row.mark === 'string' ? row.mark : null,
      orderNo: typeof row.orderNo === 'string' ? row.orderNo : null,
      amount,
      receiptId: typeof row.receiptId === 'string' ? row.receiptId : null,
    };
  });
}

function normalizeDetailSnapshot(input: DetailSnapshotSource): DetailEditablePatch {
  const rawAgentId = input?.agentId;
  const agentId = typeof rawAgentId === 'string' && rawAgentId.trim()
    ? rawAgentId.trim()
    : null;
  return {
    date: typeof input?.date === 'string' ? input.date : null,
    agentId,
    items: normalizeDetailItems(input?.items ?? []),
  };
}

function validateDetailPatch(input: DetailEditablePatch): DetailEditablePatch {
  const normalized = normalizeDetailSnapshot(input as DetailSnapshotSource);
  parseEditableDateValue(normalized.date);
  return normalized;
}

function buildScopedDetailWhere(detailId: string, ownerIds: string[]): Prisma.DetailWhereInput {
  return {
    AND: [
      { id: detailId },
      buildDetailVisibilityWhere(ownerIds),
    ],
  };
}

function toReviewDecisionMessage(decision: 'approve' | 'reject') {
  return decision === 'approve' ? '付款明细修改申请已通过' : '付款明细修改申请已拒绝';
}

function mapDetailEditRequestRow(row: {
  id: string;
  detailId: string;
  status: DetailEditRequestStatus;
  requestedBy: string;
  approvedBy: string | null;
  requestedAt: Date;
  reviewedAt: Date | null;
  beforeSnapshot: Prisma.JsonValue;
  afterSnapshot: Prisma.JsonValue;
  reviewComment: string | null;
  requester: { name: string | null; email: string | null };
  approver: { name: string | null; email: string | null } | null;
}): DetailEditRequestRow {
  return {
    id: row.id,
    detailId: row.detailId,
    status: row.status,
    requestedBy: row.requestedBy,
    requestedByName: row.requester.name || row.requester.email || row.requestedBy,
    approvedBy: row.approvedBy,
    approvedByName: row.approver
      ? (row.approver.name || row.approver.email || row.approvedBy)
      : null,
    requestedAt: row.requestedAt.toISOString(),
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    beforeSnapshot: normalizeDetailSnapshot(row.beforeSnapshot as DetailSnapshotSource),
    afterSnapshot: normalizeDetailSnapshot(row.afterSnapshot as DetailSnapshotSource),
    reviewComment: row.reviewComment,
  };
}

async function buildDetailEditRequestWhere(currentUser: CurrentUser): Promise<Prisma.DetailEditRequestWhereInput> {
  const scope = await getHierarchyScope(currentUser);
  const ownerIds = Array.from(scope.ownerVisibleIds);
  const detailVisibilityWhere = buildDetailVisibilityWhere(ownerIds);

  if (currentUser.role === UserRole.SALES) {
    return {
      AND: [
        { requestedBy: currentUser.id },
        { detail: detailVisibilityWhere },
      ],
    };
  }

  const descendantIds = Array.from(scope.descendantIds);
  const visibleRequesterIds = Array.from(scope.visibleIds);
  const branches: Prisma.DetailEditRequestWhereInput[] = [];

  if (descendantIds.length > 0) {
    branches.push({
      AND: [
        { status: DetailEditRequestStatus.PENDING },
        { requestedBy: { in: descendantIds } },
        { detail: detailVisibilityWhere },
      ],
    });
  }

  if (visibleRequesterIds.length > 0) {
    branches.push({
      AND: [
        { status: { in: [DetailEditRequestStatus.APPROVED, DetailEditRequestStatus.REJECTED] } },
        { requestedBy: { in: visibleRequesterIds } },
        { detail: detailVisibilityWhere },
      ],
    });
  }

  return branches.length === 1 ? branches[0] : { OR: branches };
}

export async function requestDetailEdit(params: {
  currentUser: CurrentUser;
  detailId: string;
  data: DetailEditablePatch;
}) {
  const { currentUser, detailId } = params;
  const afterSnapshot = validateDetailPatch(params.data);

  if (currentUser.role !== UserRole.SALES) {
    throw forbidden('DETAIL_EDIT_REQUEST_FORBIDDEN', '只有销售可以提交付款明细修改申请', {
      role: currentUser.role,
      detailId,
    });
  }
  if (!detailId) {
    throw badRequest('缺少付款明细ID');
  }

  const scope = await getHierarchyScope(currentUser);
  const ownerIds = Array.from(scope.ownerVisibleIds);

  try {
    const request = await runInTransaction(async (tx) => {
      const detail = await tx.detail.findFirst({
        where: buildScopedDetailWhere(detailId, ownerIds),
        select: {
          id: true,
          createdBy: true,
          status: true,
          date: true,
          agentId: true,
          items: {
            select: {
              mark: true,
              orderNo: true,
              amount: true,
              receiptId: true,
            },
          },
        },
      });

      if (!detail) {
        throw forbidden('DETAIL_EDIT_REQUEST_FORBIDDEN', '无权申请修改该付款明细', {
          detailId,
          ownerIds,
        });
      }

      assertEditableDetailStatus(detail.status, { detailId, status: detail.status });

      const existingPending = await tx.detailEditRequest.findFirst({
        where: {
          pendingDetailId: detailId,
          status: DetailEditRequestStatus.PENDING,
        },
        select: { id: true },
      });
      if (existingPending) {
        throw apiError('DETAIL_EDIT_REQUEST_EXISTS', 409, '该付款明细已有待审批的修改申请', {
          detailId,
          requestId: existingPending.id,
        });
      }

      const beforeSnapshot: DetailEditablePatch = {
        date: detail.date instanceof Date ? detail.date.toISOString().slice(0, 10) : null,
        agentId: detail.agentId ?? null,
        items: detail.items.map((item) => ({
          mark: item.mark,
          orderNo: item.orderNo,
          amount: Number(item.amount),
          receiptId: item.receiptId,
        })),
      };

      return tx.detailEditRequest.create({
        data: {
          detailId,
          requestedBy: currentUser.id,
          pendingDetailId: detailId,
          status: DetailEditRequestStatus.PENDING,
          beforeSnapshot,
          afterSnapshot,
        },
      });
    });

    await recordAuditEvent({
      action: auditActions.DETAIL_EDIT_REQUEST_CREATE,
      actorId: currentUser.id,
      targetType: auditTargetTypes.DETAIL_EDIT_REQUEST,
      targetId: request.id,
      metadata: {
        detailId,
        pendingDetailId: detailId,
        afterSnapshot,
      },
    });

    return {
      data: request,
      message: '付款明细修改申请已提交，等待管理员同意',
    };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw apiError('DETAIL_EDIT_REQUEST_EXISTS', 409, '该付款明细已有待审批的修改申请', {
        detailId,
      });
    }
    throw error;
  }
}

export async function reviewDetailEdit(params: {
  currentUser: CurrentUser;
  requestId: string;
  decision: 'approve' | 'reject';
  comment?: string | null;
}) {
  const { currentUser, requestId, decision, comment } = params;

  if (currentUser.role !== UserRole.ADMIN) {
    throw forbidden('DETAIL_EDIT_REVIEW_FORBIDDEN', '只有管理员可以审批付款明细修改申请', {
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
    const request = await tx.detailEditRequest.findUnique({
      where: { id: requestId },
      include: {
        detail: true,
        requester: true,
      },
    });

    if (!request) {
      throw apiError('RESOURCE_NOT_FOUND', 400, '申请不存在', { requestId });
    }
    if (request.status !== DetailEditRequestStatus.PENDING) {
      throw apiError('DETAIL_EDIT_REQUEST_ALREADY_PROCESSED', 400, '该申请已处理', {
        requestId,
        status: request.status,
      });
    }
    if (request.requestedBy === currentUser.id) {
      throw forbidden('DETAIL_EDIT_REVIEW_FORBIDDEN', '不能审批自己提交的付款明细修改申请', {
        requestId,
        requestedBy: request.requestedBy,
      });
    }
    if (!descendantIds.has(request.requestedBy)) {
      throw forbidden('DETAIL_EDIT_REVIEW_FORBIDDEN', '无权审批该付款明细修改申请', {
        requestId,
        requestedBy: request.requestedBy,
      });
    }

    const visibleDetail = await tx.detail.findFirst({
      where: buildScopedDetailWhere(request.detailId, ownerIds),
      select: { id: true, status: true },
    });
    if (!visibleDetail) {
      throw forbidden('DETAIL_EDIT_REVIEW_FORBIDDEN', '无权审批该付款明细修改申请', {
        requestId,
        detailId: request.detailId,
      });
    }

    assertEditableDetailStatus(visibleDetail.status, { detailId: request.detailId, status: visibleDetail.status });

    const nextSnapshot = validateDetailPatch(request.afterSnapshot as DetailSnapshotSource as DetailEditablePatch);
    const reviewedAt = new Date();
    const claimResult = await tx.detailEditRequest.updateMany({
      where: {
        id: requestId,
        status: DetailEditRequestStatus.PENDING,
        pendingDetailId: request.detailId,
      },
      data: {
        status: decision === 'approve' ? DetailEditRequestStatus.APPROVED : DetailEditRequestStatus.REJECTED,
        approvedBy: currentUser.id,
        reviewComment: comment ?? null,
        reviewedAt,
        pendingDetailId: null,
      },
    });

    if (claimResult.count !== 1) {
      throw apiError('DETAIL_EDIT_REQUEST_ALREADY_PROCESSED', 400, '该申请已处理', { requestId });
    }

    if (decision === 'approve') {
      const result = await updateDetailRecord({
        currentUser,
        detailId: request.detailId,
        payload: nextSnapshot,
        txClient: tx,
        skipAudit: true,
        historyNote: '审批修改前保存',
      });
      return result.touchedOrderIds;
    }
    return [];
  });

  await recordAuditEvent({
    action: decision === 'approve'
      ? auditActions.DETAIL_EDIT_REQUEST_APPROVE
      : auditActions.DETAIL_EDIT_REQUEST_REJECT,
    actorId: currentUser.id,
    targetType: auditTargetTypes.DETAIL_EDIT_REQUEST,
    targetId: requestId,
    metadata: {
      decision,
      comment: comment ?? null,
    },
  });

  return { message: toReviewDecisionMessage(decision) };
}

export async function listDetailEditRequests(currentUser: CurrentUser): Promise<DetailEditRequestRow[]> {
  const where = await buildDetailEditRequestWhere(currentUser);
  const rows = await db.detailEditRequest.findMany({
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

  return rows.map(mapDetailEditRequestRow);
}
