import type { Prisma } from '@prisma/client';
import { UserRole } from '@prisma/client';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { createApiError } from '@/lib/api-error';
import { db } from '@/lib/db';
import { canAccessOwnedResourceAsync } from '@/lib/ownership';
import { buildReceiptVisibilityWhere } from '@/lib/resource-visibility';
import type { CurrentUser } from '@/lib/request-auth';
import type { ReceiptEditablePatch, ReceiptEditRequestRow } from '@/lib/receipt-edit-types';
import { runInTransaction } from '@/lib/transaction';
import { getHierarchyScope } from '@/lib/user-hierarchy';

const editableFields = [
  'receiptNo',
  'date',
  'invNo',
  'customerMark',
  'payer',
  'tel',
] as const;

type EditableField = (typeof editableFields)[number];
const receiptEditRequestStatuses = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;

type EditableSnapshotSource = Partial<Record<EditableField, unknown>> | null | undefined;

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

function normalizeEditableSnapshot(input: EditableSnapshotSource): ReceiptEditablePatch {
  return {
    receiptNo: typeof input?.receiptNo === 'string' ? input.receiptNo : null,
    date: typeof input?.date === 'string' ? input.date : null,
    invNo: typeof input?.invNo === 'string' ? input.invNo : null,
    customerMark: typeof input?.customerMark === 'string' ? input.customerMark : null,
    payer: typeof input?.payer === 'string' ? input.payer : null,
    tel: typeof input?.tel === 'string' ? input.tel : null,
  };
}

function toReviewDecisionMessage(decision: 'approve' | 'reject'): string {
  return decision === 'approve' ? '收据修改申请已通过' : '收据修改申请已拒绝';
}

function buildReceiptEditRequestWhere(currentUser: CurrentUser): Promise<Prisma.ReceiptEditRequestWhereInput> {
  return getHierarchyScope(currentUser).then((scope) => {
    const ownerIds = Array.from(scope.ownerVisibleIds);
    const receiptVisibilityWhere = buildReceiptVisibilityWhere(ownerIds);

    if (currentUser.role === UserRole.SALES) {
      return {
        AND: [
          { requestedBy: currentUser.id },
          { receipt: receiptVisibilityWhere },
        ],
      };
    }

    const descendantIds = Array.from(scope.descendantIds);
    const visibleRequesterIds = Array.from(scope.visibleIds);
    const branches: Prisma.ReceiptEditRequestWhereInput[] = [];

    if (descendantIds.length > 0) {
      branches.push({
        AND: [
          { status: receiptEditRequestStatuses.PENDING },
          { requestedBy: { in: descendantIds } },
          { receipt: receiptVisibilityWhere },
        ],
      });
    }

    if (visibleRequesterIds.length > 0) {
      branches.push({
        AND: [
          {
            status: {
              in: [
                receiptEditRequestStatuses.APPROVED,
                receiptEditRequestStatuses.REJECTED,
              ],
            },
          },
          { requestedBy: { in: visibleRequesterIds } },
          { receipt: receiptVisibilityWhere },
        ],
      });
    }

    if (branches.length === 1) {
      return branches[0];
    }

    return { OR: branches };
  });
}

export async function requestReceiptEdit(params: {
  currentUser: CurrentUser;
  receiptId: string;
  data: ReceiptEditablePatch;
}) {
  const { currentUser, receiptId, data } = params;

  if (currentUser.role !== UserRole.SALES) {
    throw forbidden('RECEIPT_EDIT_REQUEST_FORBIDDEN', '只有销售可以提交收据修改申请', {
      role: currentUser.role,
      receiptId,
    });
  }
  if (!receiptId) {
    throw badRequest('缺少收据ID');
  }

  const receipt = await db.receipt.findUnique({
    where: { id: receiptId },
    select: {
      id: true,
      createdBy: true,
      status: true,
      receiptNo: true,
      date: true,
      invNo: true,
      customerMark: true,
      payer: true,
      tel: true,
    },
  });
  if (!receipt) {
    throw apiError('RESOURCE_NOT_FOUND', 400, '收据不存在', { receiptId });
  }

  if (!(await canAccessOwnedResourceAsync(receipt.createdBy, currentUser))) {
    throw forbidden('RECEIPT_EDIT_REQUEST_FORBIDDEN', '无权申请修改该收据', {
      receiptId,
      createdBy: receipt.createdBy,
    });
  }

  const existingPending = await db.receiptEditRequest.findFirst({
    where: {
      pendingReceiptId: receiptId,
      status: receiptEditRequestStatuses.PENDING,
    },
    select: { id: true },
  });
  if (existingPending) {
    throw apiError('RECEIPT_EDIT_REQUEST_EXISTS', 409, '该收据已有待审批的修改申请', {
      receiptId,
      requestId: existingPending.id,
    });
  }

  const beforeSnapshot = normalizeEditableSnapshot({
    receiptNo: receipt.receiptNo,
    date: receipt.date instanceof Date ? receipt.date.toISOString().slice(0, 10) : receipt.date,
    invNo: receipt.invNo,
    customerMark: receipt.customerMark,
    payer: receipt.payer,
    tel: receipt.tel,
  });
  const afterSnapshot = normalizeEditableSnapshot(data);

  const request = await db.receiptEditRequest.create({
    data: {
      receiptId,
      requestedBy: currentUser.id,
      pendingReceiptId: receiptId,
      status: receiptEditRequestStatuses.PENDING,
      beforeSnapshot,
      afterSnapshot,
    },
  });

  await recordAuditEvent({
    action: auditActions.RECEIPT_EDIT_REQUEST_CREATE,
    actorId: currentUser.id,
    targetType: auditTargetTypes.RECEIPT_EDIT_REQUEST,
    targetId: request.id,
    metadata: {
      receiptId,
      pendingReceiptId: receiptId,
      beforeSnapshot,
      afterSnapshot,
    },
  });

  return {
    data: request,
    message: '收据修改申请已提交，等待管理员同意',
  };
}

export async function reviewReceiptEdit(params: {
  currentUser: CurrentUser;
  requestId: string;
  decision: 'approve' | 'reject';
  comment?: string | null;
}) {
  const { currentUser, requestId, decision, comment } = params;

  if (currentUser.role !== UserRole.ADMIN) {
    throw forbidden('RECEIPT_EDIT_REVIEW_FORBIDDEN', '只有管理员可以审批收据修改申请', {
      role: currentUser.role,
      requestId,
    });
  }
  if (!requestId) {
    throw badRequest('缺少申请ID');
  }

  await runInTransaction(async (tx) => {
    const request = await tx.receiptEditRequest.findUnique({
      where: { id: requestId },
      include: {
        receipt: true,
        requester: true,
      },
    });

    if (!request) {
      throw apiError('RESOURCE_NOT_FOUND', 400, '申请不存在', { requestId });
    }
    if (request.status !== receiptEditRequestStatuses.PENDING) {
      throw apiError('RECEIPT_EDIT_REQUEST_ALREADY_PROCESSED', 400, '该申请已处理', {
        requestId,
        status: request.status,
      });
    }
    if (request.requestedBy === currentUser.id) {
      throw forbidden('RECEIPT_EDIT_REVIEW_FORBIDDEN', '不能审批自己提交的收据修改申请', {
        requestId,
        requestedBy: request.requestedBy,
      });
    }
    if (!(await canAccessOwnedResourceAsync(request.requestedBy, currentUser))) {
      throw forbidden('RECEIPT_EDIT_REVIEW_FORBIDDEN', '无权审批该收据修改申请', {
        requestId,
        requestedBy: request.requestedBy,
      });
    }

    if (decision === 'approve') {
      const nextSnapshot = normalizeEditableSnapshot(request.afterSnapshot as EditableSnapshotSource);

      await tx.receiptHistory.create({
        data: {
          receiptId: request.receiptId,
          receiptNo: request.receipt.receiptNo,
          date: request.receipt.date,
          tel: request.receipt.tel,
          usd: request.receipt.usd,
          invNo: request.receipt.invNo,
          orderNo: request.receipt.orderNo,
          payer: request.receipt.payer,
          imageUrl: request.receipt.imageUrl,
          imageName: request.receipt.imageName,
          status: request.receipt.status,
          note: '审批修改前保存',
          createdBy: currentUser.id,
        },
      });

      await tx.receipt.update({
        where: { id: request.receiptId },
        data: {
          receiptNo: nextSnapshot.receiptNo,
          date: nextSnapshot.date ? new Date(nextSnapshot.date) : null,
          invNo: nextSnapshot.invNo,
          customerMark: nextSnapshot.customerMark,
          payer: nextSnapshot.payer,
          tel: nextSnapshot.tel,
        },
      });
    }

    await tx.receiptEditRequest.update({
      where: { id: requestId },
      data: {
        status: decision === 'approve'
          ? receiptEditRequestStatuses.APPROVED
          : receiptEditRequestStatuses.REJECTED,
        approvedBy: currentUser.id,
        reviewComment: comment ?? null,
        reviewedAt: new Date(),
        pendingReceiptId: null,
      },
    });
  });

  await recordAuditEvent({
    action: decision === 'approve'
      ? auditActions.RECEIPT_EDIT_REQUEST_APPROVE
      : auditActions.RECEIPT_EDIT_REQUEST_REJECT,
    actorId: currentUser.id,
    targetType: auditTargetTypes.RECEIPT_EDIT_REQUEST,
    targetId: requestId,
    metadata: {
      decision,
      comment: comment ?? null,
    },
  });

  return { message: toReviewDecisionMessage(decision) };
}

export async function listReceiptEditRequests(currentUser: CurrentUser): Promise<ReceiptEditRequestRow[]> {
  const where = await buildReceiptEditRequestWhere(currentUser);
  const rows = await db.receiptEditRequest.findMany({
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
      { id: 'desc' },
    ],
  });

  return rows.map((row) => ({
    id: row.id,
    receiptId: row.receiptId,
    status: row.status,
    requestedBy: row.requestedBy,
    requestedByName: row.requester.name || row.requester.email || row.requestedBy,
    approvedBy: row.approvedBy,
    approvedByName: row.approver
      ? (row.approver.name || row.approver.email || row.approvedBy)
      : null,
    requestedAt: row.requestedAt.toISOString(),
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    beforeSnapshot: normalizeEditableSnapshot(row.beforeSnapshot as EditableSnapshotSource),
    afterSnapshot: normalizeEditableSnapshot(row.afterSnapshot as EditableSnapshotSource),
    reviewComment: row.reviewComment,
  }));
}
