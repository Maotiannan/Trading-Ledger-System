import {
  DeletionStatus,
  DeletionTargetType,
  DetailStatus,
  ReceiptStatus,
  UserRole,
} from '@prisma/client';
import { db } from '@/lib/db';
import { canAccessOwnedResourceAsync } from '@/lib/ownership';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions } from '@/lib/audit-catalog';
import { updateOrderBalance } from '@/lib/matching';
import { createApiError } from '@/lib/api-error';
import { runInTransaction, type DbTransactionClient } from '@/lib/transaction';
import type { CurrentUser } from '@/lib/request-auth';

const AUTO_DETAIL_RECEIPT_NOTES = new Set(['由付款明细自动创建', '由付款明细直接创建']);

export type DeletionActor = CurrentUser;

export type DeletionReviewAction = 'approve' | 'reject';

function assertAdmin(currentUser: DeletionActor): void {
  if (currentUser.role !== UserRole.ADMIN) {
    throw createApiError({
      code: 'FORBIDDEN',
      status: 403,
      message: '只有管理员可以审批',
      detail: { role: currentUser.role },
    });
  }
}

export function ensureDeletionTargetType(targetType: string): DeletionTargetType {
  if (
    targetType === DeletionTargetType.RECEIPT ||
    targetType === DeletionTargetType.DETAIL ||
    targetType === DeletionTargetType.SWIFT
  ) {
    return targetType;
  }

  throw createApiError({
    code: 'INVALID_TARGET_TYPE',
    status: 400,
    message: '无效的删除目标类型',
    detail: { targetType },
  });
}

function getDeletionBlockedStatusMessage(status: string): string | null {
  if (status === 'RECEIVED') {
    return 'RECEIVED状态下禁止删除';
  }
  if (status === 'Bank_Transfer') {
    return 'Bank_Transfer状态下禁止删除';
  }
  return null;
}

async function assertDeletionRequestableTarget(
  currentUser: DeletionActor,
  targetType: DeletionTargetType,
  targetId: string
): Promise<void> {
  if (targetType === DeletionTargetType.RECEIPT) {
    const receipt = await db.receipt.findUnique({ where: { id: targetId } });
    if (!receipt) {
      throw createApiError({
        code: 'RESOURCE_NOT_FOUND',
        status: 400,
        message: '收据不存在',
        detail: { targetType, targetId },
      });
    }
    const canRequestSigningPendingDeletion =
      receipt.status === ReceiptStatus.SIGNING_PENDING
      && (currentUser.role === UserRole.ADMIN || receipt.createdBy === currentUser.id);
    if (!canRequestSigningPendingDeletion && !(await canAccessOwnedResourceAsync(receipt.createdBy, currentUser))) {
      throw createApiError({
        code: 'FORBIDDEN',
        status: 403,
        message: '无权申请删除该收据',
        detail: { targetType, targetId, createdBy: receipt.createdBy },
      });
    }

    const blockedMessage = getDeletionBlockedStatusMessage(receipt.status);
    if (blockedMessage && !(receipt.status === ReceiptStatus.RECEIVED && currentUser.role === UserRole.ADMIN)) {
      throw createApiError({
        code: 'DELETION_NOT_ALLOWED',
        status: 400,
        message: blockedMessage,
        detail: { targetType, targetId, status: receipt.status },
      });
    }
    return;
  }

  if (targetType === DeletionTargetType.DETAIL) {
    const detail = await db.detail.findUnique({ where: { id: targetId } });
    if (!detail) {
      throw createApiError({
        code: 'RESOURCE_NOT_FOUND',
        status: 400,
        message: '付款明细不存在',
        detail: { targetType, targetId },
      });
    }
    if (!(await canAccessOwnedResourceAsync(detail.createdBy, currentUser))) {
      throw createApiError({
        code: 'FORBIDDEN',
        status: 403,
        message: '无权申请删除该明细',
        detail: { targetType, targetId, createdBy: detail.createdBy },
      });
    }

    const blockedMessage = getDeletionBlockedStatusMessage(detail.status);
    if (blockedMessage) {
      throw createApiError({
        code: 'DELETION_NOT_ALLOWED',
        status: 400,
        message: blockedMessage,
        detail: { targetType, targetId, status: detail.status },
      });
    }
    return;
  }

  const swift = await db.swift.findUnique({ where: { id: targetId } });
  if (!swift) {
    throw createApiError({
      code: 'RESOURCE_NOT_FOUND',
      status: 400,
      message: 'SWIFT不存在',
      detail: { targetType, targetId },
    });
  }
  if (!(await canAccessOwnedResourceAsync(swift.createdBy, currentUser))) {
    throw createApiError({
      code: 'FORBIDDEN',
      status: 403,
      message: '无权申请删除该SWIFT',
      detail: { targetType, targetId, createdBy: swift.createdBy },
    });
  }
}

async function approveReceiptDeletion(
  tx: DbTransactionClient,
  targetId: string,
  actorId: string
): Promise<{ affectedOrderId: string | null }> {
  const receipt = await tx.receipt.findUnique({ where: { id: targetId } });
  if (!receipt) {
    return { affectedOrderId: null };
  }

  const affectedDetailItems = await tx.detailItem.findMany({
    where: { receiptId: targetId },
    select: { detailId: true },
  });
  const affectedDetailIds = Array.from(new Set(affectedDetailItems.map((row) => row.detailId)));

  await tx.receiptHistory.create({
    data: {
      receiptId: targetId,
      receiptNo: receipt.receiptNo,
      date: receipt.date,
      tel: receipt.tel,
      usd: receipt.usd,
      invNo: receipt.invNo,
      orderNo: receipt.orderNo,
      payer: receipt.payer,
      imageUrl: receipt.imageUrl,
      imageName: receipt.imageName,
      status: receipt.status,
      note: '删除前保存',
      createdBy: actorId,
    },
  });

  await tx.detailItem.deleteMany({ where: { receiptId: targetId } });
  await tx.receipt.delete({ where: { id: targetId } });

  for (const detailId of affectedDetailIds) {
    const remainItems = await tx.detailItem.findMany({
      where: { detailId },
      select: { amount: true },
    });
    const totalAmount = remainItems.reduce((sum, item) => sum + Number(item.amount), 0);
    await tx.detail.update({
      where: { id: detailId },
      data: { totalAmount },
    });
  }

  return { affectedOrderId: receipt.orderId };
}

async function approveDetailDeletion(
  tx: DbTransactionClient,
  targetId: string
): Promise<void> {
  const detail = await tx.detail.findUnique({
    where: { id: targetId },
    include: { items: true },
  });
  if (!detail) {
    return;
  }

  const receiptIds = Array.from(
    new Set(detail.items.map((item) => item.receiptId).filter((id): id is string => Boolean(id)))
  );
  const receipts = receiptIds.length > 0
    ? await tx.receipt.findMany({
        where: { id: { in: receiptIds } },
        select: {
          id: true,
          note: true,
          orderId: true,
          createdBy: true,
        },
      })
    : [];

  for (const item of detail.items) {
    if (item.receiptId) {
      await tx.receipt.update({
        where: { id: item.receiptId },
        data: { status: ReceiptStatus.SR_Received },
      });
    }
  }

  await tx.detailItem.deleteMany({ where: { detailId: targetId } });
  await tx.detail.delete({ where: { id: targetId } });

  const affectedOrderIds = new Set<string>();
  const autoOrderCandidates = new Set<string>();

  for (const receipt of receipts) {
    if (receipt.orderId) {
      affectedOrderIds.add(receipt.orderId);
    }

    const isAutoCreatedByDetail =
      AUTO_DETAIL_RECEIPT_NOTES.has(String(receipt.note || '')) &&
      receipt.createdBy === detail.createdBy;
    if (!isAutoCreatedByDetail) {
      continue;
    }

    const stillLinkedCount = await tx.detailItem.count({
      where: { receiptId: receipt.id },
    });
    if (stillLinkedCount > 0) {
      continue;
    }

    await tx.receipt.delete({ where: { id: receipt.id } });
    if (receipt.orderId) {
      autoOrderCandidates.add(receipt.orderId);
    }
  }

  for (const orderId of autoOrderCandidates) {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        invoice: { select: { invNo: true } },
        _count: { select: { receipts: true } },
      },
    });
    if (!order) continue;
    if (order.invoice.invNo !== 'Un_Associated') continue;
    if (Number(order.amount) !== 0) continue;
    if (order._count.receipts > 0) continue;

    await tx.order.delete({ where: { id: orderId } });
    affectedOrderIds.delete(orderId);
  }

  for (const orderId of affectedOrderIds) {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { amount: true },
    });
    if (!order) continue;

    const receiptAgg = await tx.receipt.aggregate({
      where: { orderId },
      _sum: { usd: true },
    });
    const receiptSum = Number(receiptAgg._sum.usd ?? 0);
    await tx.order.update({
      where: { id: orderId },
      data: { orderBalance: Number(order.amount) - receiptSum },
    });
  }
}

async function approveSwiftDeletion(
  tx: DbTransactionClient,
  targetId: string
): Promise<void> {
  const swift = await tx.swift.findUnique({ where: { id: targetId } });
  if (!swift) {
    return;
  }

  await tx.detail.update({
    where: { id: swift.detailId },
    data: { status: DetailStatus.Waiting_SWIFT },
  });

  const detail = await tx.detail.findUnique({
    where: { id: swift.detailId },
    include: { items: true },
  });

  if (detail) {
    for (const item of detail.items) {
      if (item.receiptId) {
        await tx.receipt.update({
          where: { id: item.receiptId },
          data: { status: ReceiptStatus.Waiting_SWIFT },
        });
      }
    }
  }

  await tx.swift.delete({ where: { id: targetId } });
}

export async function listDeletionRequests(currentUser: DeletionActor) {
  return db.deletionRequest.findMany({
    where: currentUser.role === UserRole.USER ? { requestedBy: currentUser.id } : undefined,
    include: {
      requester: { select: { id: true, name: true, email: true } },
      approver: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createDeletionRequest({
  currentUser,
  targetType,
  targetId,
  reason,
}: {
  currentUser: DeletionActor;
  targetType: string;
  targetId: string;
  reason?: string | null;
}) {
  if (!targetType || !targetId) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: '缺少必要参数',
      detail: { targetType, targetId },
    });
  }

  const normalizedTargetType = ensureDeletionTargetType(targetType);
  const existingRequest = await db.deletionRequest.findFirst({
    where: { targetType: normalizedTargetType, targetId },
    select: { id: true, status: true },
  });
  if (existingRequest) {
    throw createApiError({
      code: 'DELETION_REQUEST_EXISTS',
      status: 400,
      message: `该记录已存在删除申请（${existingRequest.status}），不可重复申请`,
      detail: {
        requestId: existingRequest.id,
        status: existingRequest.status,
        targetType: normalizedTargetType,
        targetId,
      },
    });
  }

  await assertDeletionRequestableTarget(currentUser, normalizedTargetType, targetId);

  const deletionRequest = await db.deletionRequest.create({
    data: {
      targetType: normalizedTargetType,
      targetId,
      reason,
      requestedBy: currentUser.id,
      status: DeletionStatus.PENDING,
    },
    include: {
      requester: { select: { id: true, name: true, email: true } },
    },
  });

  await recordAuditEvent({
    action: auditActions.DELETION_REQUEST_CREATE,
    actorId: currentUser.id,
    targetType: normalizedTargetType,
    targetId,
    metadata: { requestId: deletionRequest.id },
  });

  return deletionRequest;
}

export async function reviewDeletionRequest({
  currentUser,
  action,
  requestId,
}: {
  currentUser: DeletionActor;
  action: DeletionReviewAction;
  requestId: string;
}) {
  assertAdmin(currentUser);

  if (!requestId) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: '缺少申请ID',
    });
  }

  const existingRequest = await db.deletionRequest.findUnique({
    where: { id: requestId },
  });
  if (!existingRequest) {
    throw createApiError({
      code: 'DELETION_REQUEST_NOT_FOUND',
      status: 400,
      message: '申请不存在',
      detail: { requestId },
    });
  }

  if (existingRequest.status !== DeletionStatus.PENDING) {
    throw createApiError({
      code: 'DELETION_REQUEST_ALREADY_PROCESSED',
      status: 400,
      message: '该申请已处理',
      detail: { requestId, status: existingRequest.status },
    });
  }

  if (action === 'reject') {
    await db.deletionRequest.update({
      where: { id: requestId },
      data: {
        status: DeletionStatus.REJECTED,
        approvedBy: currentUser.id,
        approvedAt: new Date(),
      },
    });
    await recordAuditEvent({
      action: auditActions.DELETION_REQUEST_REJECT,
      actorId: currentUser.id,
      targetType: existingRequest.targetType,
      targetId: existingRequest.targetId,
      metadata: { requestId },
    });
    return { message: '申请已拒绝' };
  }

  let affectedReceiptOrderId: string | null = null;

  await runInTransaction(async (tx) => {
    const requestInTx = await tx.deletionRequest.findUnique({
      where: { id: requestId },
    });
    if (!requestInTx || requestInTx.status !== DeletionStatus.PENDING) {
      throw createApiError({
        code: 'DELETION_REQUEST_STATE_CHANGED',
        status: 409,
        message: '删除申请状态已变化，请刷新后重试',
        detail: { requestId, status: requestInTx?.status ?? null },
      });
    }

    if (requestInTx.targetType === DeletionTargetType.RECEIPT) {
      const result = await approveReceiptDeletion(tx, requestInTx.targetId, currentUser.id);
      affectedReceiptOrderId = result.affectedOrderId;
    } else if (requestInTx.targetType === DeletionTargetType.DETAIL) {
      await approveDetailDeletion(tx, requestInTx.targetId);
    } else if (requestInTx.targetType === DeletionTargetType.SWIFT) {
      await approveSwiftDeletion(tx, requestInTx.targetId);
    }

    await tx.deletionRequest.update({
      where: { id: requestId },
      data: {
        status: DeletionStatus.APPROVED,
        approvedBy: currentUser.id,
        approvedAt: new Date(),
      },
    });
  });

  if (affectedReceiptOrderId) {
    await updateOrderBalance(affectedReceiptOrderId);
  }

  await recordAuditEvent({
    action: auditActions.DELETION_REQUEST_APPROVE,
    actorId: currentUser.id,
    targetType: existingRequest.targetType,
    targetId: existingRequest.targetId,
    metadata: { requestId },
  });

  return { message: '删除成功，状态已回退' };
}
