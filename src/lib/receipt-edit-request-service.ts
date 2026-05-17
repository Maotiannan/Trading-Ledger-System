import { Prisma, ReceiptEditRequestStatus, UserRole } from '@prisma/client';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { createApiError } from '@/lib/api-error';
import { db } from '@/lib/db';
import { buildReceiptVisibilityWhere } from '@/lib/resource-visibility';
import type { CurrentUser } from '@/lib/request-auth';
import type { ReceiptEditablePatch, ReceiptEditRequestRow } from '@/lib/receipt-edit-types';
import { resolveReceiptEditBinding, syncReceiptDetailItemsForBinding } from '@/lib/receipt-edit-binding';
import { updateOrderBalance } from '@/lib/matching';
import { runInTransaction } from '@/lib/transaction';
import { getHierarchyScope } from '@/lib/user-hierarchy';

type EditableSnapshotSource = Partial<Record<keyof ReceiptEditablePatch, unknown>> | null | undefined;

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
  if (date == null) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw badRequest('收据日期格式无效', { date });
  }

  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw badRequest('收据日期格式无效', { date });
  }

  return parsed;
}

function normalizeEditableSnapshot(input: EditableSnapshotSource): ReceiptEditablePatch {
  return {
    receiptNo: typeof input?.receiptNo === 'string' ? input.receiptNo : null,
    date: typeof input?.date === 'string' ? input.date : null,
    orderNo: typeof input?.orderNo === 'string' ? input.orderNo : null,
    invNo: typeof input?.invNo === 'string' ? input.invNo : null,
    customerMark: typeof input?.customerMark === 'string' ? input.customerMark : null,
    payer: typeof input?.payer === 'string' ? input.payer : null,
    tel: typeof input?.tel === 'string' ? input.tel : null,
  };
}

function validateEditablePatch(input: ReceiptEditablePatch): ReceiptEditablePatch {
  const normalized = normalizeEditableSnapshot(input);
  parseEditableDateValue(normalized.date);
  return normalized;
}

function buildScopedReceiptWhere(receiptId: string, ownerIds: string[]): Prisma.ReceiptWhereInput {
  return {
    AND: [
      { id: receiptId },
      buildReceiptVisibilityWhere(ownerIds),
    ],
  };
}

function toReviewDecisionMessage(decision: 'approve' | 'reject'): string {
  return decision === 'approve' ? '收据修改申请已通过' : '收据修改申请已拒绝';
}

function mapReceiptEditRequestRow(row: {
  id: string;
  receiptId: string;
  status: ReceiptEditRequestStatus;
  requestedBy: string;
  approvedBy: string | null;
  requestedAt: Date;
  reviewedAt: Date | null;
  beforeSnapshot: Prisma.JsonValue;
  afterSnapshot: Prisma.JsonValue;
  reviewComment: string | null;
  requester: { name: string | null; email: string | null };
  approver: { name: string | null; email: string | null } | null;
}): ReceiptEditRequestRow {
  return {
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
  };
}

async function buildReceiptEditRequestWhere(currentUser: CurrentUser): Promise<Prisma.ReceiptEditRequestWhereInput> {
  const scope = await getHierarchyScope(currentUser);
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
        { status: ReceiptEditRequestStatus.PENDING },
        { requestedBy: { in: descendantIds } },
        { receipt: receiptVisibilityWhere },
      ],
    });
  }

  if (visibleRequesterIds.length > 0) {
    branches.push({
      AND: [
        { status: { in: [ReceiptEditRequestStatus.APPROVED, ReceiptEditRequestStatus.REJECTED] } },
        { requestedBy: { in: visibleRequesterIds } },
        { receipt: receiptVisibilityWhere },
      ],
    });
  }

  if (branches.length === 1) {
    return branches[0];
  }

  return { OR: branches };
}

export async function requestReceiptEdit(params: {
  currentUser: CurrentUser;
  receiptId: string;
  data: ReceiptEditablePatch;
}) {
  const { currentUser, receiptId } = params;
  const afterSnapshot = validateEditablePatch(params.data);

  if (currentUser.role !== UserRole.SALES) {
    throw forbidden('RECEIPT_EDIT_REQUEST_FORBIDDEN', '只有销售可以提交收据修改申请', {
      role: currentUser.role,
      receiptId,
    });
  }
  if (!receiptId) {
    throw badRequest('缺少收据ID');
  }

  const scope = await getHierarchyScope(currentUser);
  const ownerIds = Array.from(scope.ownerVisibleIds);

  try {
    const request = await runInTransaction(async (tx) => {
      const receipt = await tx.receipt.findFirst({
        where: buildScopedReceiptWhere(receiptId, ownerIds),
        select: {
          id: true,
          status: true,
          receiptNo: true,
          date: true,
          orderNo: true,
          invNo: true,
          customerMark: true,
          payer: true,
          tel: true,
        },
      });

      if (!receipt) {
        throw forbidden('RECEIPT_EDIT_REQUEST_FORBIDDEN', '无权申请修改该收据', {
          receiptId,
          ownerIds,
        });
      }

      const existingPending = await tx.receiptEditRequest.findFirst({
        where: {
          pendingReceiptId: receiptId,
          status: ReceiptEditRequestStatus.PENDING,
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
        date: receipt.date instanceof Date ? receipt.date.toISOString().slice(0, 10) : null,
        orderNo: receipt.orderNo,
        invNo: receipt.invNo,
        customerMark: receipt.customerMark,
        payer: receipt.payer,
        tel: receipt.tel,
      });

      return tx.receiptEditRequest.create({
        data: {
          receiptId,
          requestedBy: currentUser.id,
          pendingReceiptId: receiptId,
          status: ReceiptEditRequestStatus.PENDING,
          beforeSnapshot,
          afterSnapshot,
        },
      });
    });

    await recordAuditEvent({
      action: auditActions.RECEIPT_EDIT_REQUEST_CREATE,
      actorId: currentUser.id,
      targetType: auditTargetTypes.RECEIPT_EDIT_REQUEST,
      targetId: request.id,
      metadata: {
        receiptId,
        pendingReceiptId: receiptId,
        afterSnapshot,
      },
    });

    return {
      data: request,
      message: '收据修改申请已提交，等待管理员同意',
    };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw apiError('RECEIPT_EDIT_REQUEST_EXISTS', 409, '该收据已有待审批的修改申请', {
        receiptId,
      });
    }
    throw error;
  }
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

  const scope = await getHierarchyScope(currentUser);
  const descendantIds = scope.descendantIds;
  const ownerIds = Array.from(scope.ownerVisibleIds);

  const touchedOrderIds = new Set<string>();
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
    if (request.status !== ReceiptEditRequestStatus.PENDING) {
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
    if (!descendantIds.has(request.requestedBy)) {
      throw forbidden('RECEIPT_EDIT_REVIEW_FORBIDDEN', '无权审批该收据修改申请', {
        requestId,
        requestedBy: request.requestedBy,
      });
    }

    const visibleReceipt = await tx.receipt.findFirst({
      where: buildScopedReceiptWhere(request.receiptId, ownerIds),
      select: { id: true },
    });
    if (!visibleReceipt) {
      throw forbidden('RECEIPT_EDIT_REVIEW_FORBIDDEN', '无权审批该收据修改申请', {
        requestId,
        receiptId: request.receiptId,
      });
    }

    const nextSnapshot = validateEditablePatch(request.afterSnapshot as EditableSnapshotSource as ReceiptEditablePatch);
    const reviewedAt = new Date();
    const claimResult = await tx.receiptEditRequest.updateMany({
      where: {
        id: requestId,
        status: ReceiptEditRequestStatus.PENDING,
        pendingReceiptId: request.receiptId,
      },
      data: {
        status: decision === 'approve' ? ReceiptEditRequestStatus.APPROVED : ReceiptEditRequestStatus.REJECTED,
        approvedBy: currentUser.id,
        reviewComment: comment ?? null,
        reviewedAt,
        pendingReceiptId: null,
      },
    });
    if (claimResult.count !== 1) {
      throw apiError('RECEIPT_EDIT_REQUEST_ALREADY_PROCESSED', 400, '该申请已处理', {
        requestId,
      });
    }

    if (decision === 'approve') {
      const binding = await resolveReceiptEditBinding(tx, {
        currentUserId: currentUser.id,
        ownerIds,
        orderNo: nextSnapshot.orderNo,
        invNo: nextSnapshot.invNo,
        isDeposit: request.receipt.isDeposit,
        customerId: request.receipt.customerId,
        customerMark: nextSnapshot.customerMark || request.receipt.customerMark,
        customerName: request.receipt.customerName,
        customerPhone: request.receipt.customerPhone,
        customerCity: request.receipt.customerCity,
        needsCustomerFix: request.receipt.needsCustomerFix,
      });

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

      const matchedCustomer = binding.matchedCustomer && binding.matchedCustomer.customerId && !binding.matchedCustomer.needsCustomerFix
        ? binding.matchedCustomer
        : null;
      await tx.receipt.update({
        where: { id: request.receiptId },
        data: {
          receiptNo: nextSnapshot.receiptNo,
          date: parseEditableDateValue(nextSnapshot.date),
          orderNo: binding.orderNo,
          orderId: binding.orderId,
          invNo: binding.invNo,
          customerMark: nextSnapshot.customerMark,
          payer: nextSnapshot.payer,
          tel: nextSnapshot.tel,
          ...(matchedCustomer
            ? {
                customerId: matchedCustomer.customerId,
                customerName: matchedCustomer.customerName,
                customerPhone: matchedCustomer.customerPhone,
                customerCity: matchedCustomer.customerCity,
                needsCustomerFix: false,
              }
            : {}),
        },
      });

      await syncReceiptDetailItemsForBinding(tx, {
        receiptId: request.receiptId,
        orderNo: binding.orderNo,
        customerMark: nextSnapshot.customerMark,
      });

      const previousOrderId = request.receipt.orderId || null;
      if (previousOrderId !== binding.orderId) {
        if (previousOrderId) touchedOrderIds.add(previousOrderId);
        if (binding.orderId) touchedOrderIds.add(binding.orderId);
      }
    }
  });

  for (const orderId of touchedOrderIds) {
    await updateOrderBalance(orderId);
  }

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

  return rows.map(mapReceiptEditRequestRow);
}
