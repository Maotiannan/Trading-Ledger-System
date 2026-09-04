import { DetailSourceMode, DetailStatus, ReceiptStatus, UploadedAssetAttachmentType } from '@prisma/client';
import { db } from '@/lib/db';
import { canAccessOwnedResourceAsync } from '@/lib/ownership';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { createApiError, isApiError } from '@/lib/api-error';
import { runInTransaction, type DbTransactionClient } from '@/lib/transaction';
import { findMatchingReceipt, findOrCreateOrder, updateOrderBalance, type FindMatchingReceiptOptions } from '@/lib/matching';
import { resolveCustomer } from '@/lib/customer-matching';
import type { CurrentUser } from '@/lib/request-auth';
import type { DetailPayload } from '@/lib/validators';
import { attachUploadedAssetByPath } from '@/lib/uploaded-asset-service';
import { resolveAccessiblePaymentAgentId } from '@/lib/payment-agent-service';
import { ensureDetailPreviewImage } from '@/lib/detail-image-assets';
import { logger } from '@/lib/logger';
import { projectPaymentReceiptInTransaction } from '@/lib/email/email-notification-projector';

type DetailProcessedItem = {
  mark: string | null;
  orderNo: string | null;
  amount: number;
  receiptId: string | null;
};

function badRequest(message: string, detail?: unknown) {
  return createApiError({ code: 'BAD_REQUEST', status: 400, message, detail });
}

function forbidden(message: string, detail?: unknown) {
  return createApiError({ code: 'FORBIDDEN', status: 403, message, detail });
}

async function resolveDetailItemCustomer(mark: string | null) {
  const normalized = typeof mark === 'string' ? mark.trim() : '';
  if (!normalized) {
    return {
      customerId: null,
      customerMark: null,
      customerName: null,
      customerPhone: null,
      customerCity: null,
      needsCustomerFix: true,
    };
  }
  const matched = await resolveCustomer({ customerMark: normalized });
  return {
    customerId: matched.customerId,
    customerMark: matched.customerMark,
    customerName: matched.customerName,
    customerPhone: matched.customerPhone,
    customerCity: matched.customerCity,
    needsCustomerFix: matched.needsCustomerFix,
  };
}

async function getAccessibleReceipt(
  receiptId: string,
  currentUser: CurrentUser,
  client: DbTransactionClient | typeof db = db,
) {
  const receipt = await client.receipt.findUnique({
    where: { id: receiptId },
    select: { id: true, createdBy: true, imageUrl: true, imageName: true, status: true },
  });
  if (!receipt) {
    throw createApiError({
      code: 'RESOURCE_NOT_FOUND',
      status: 400,
      message: '关联收据不存在',
      detail: { receiptId },
    });
  }
  if (!(await canAccessOwnedResourceAsync(receipt.createdBy, currentUser))) {
    throw forbidden('无权关联该收据', {
      receiptId,
      createdBy: receipt.createdBy,
    });
  }
  if (receipt.status === ReceiptStatus.SIGNING_PENDING) {
    throw badRequest('签名未完成的收据不能进入付款明细流程', { receiptId, status: receipt.status });
  }
  return receipt;
}

async function maybeAttachReceiptImage(
  client: DbTransactionClient | typeof db,
  receiptId: string,
  current: { imageUrl: string | null; imageName: string | null },
  imagePath: string | null,
  imageName: string | null
): Promise<void> {
  if (!imagePath || current.imageUrl) return;
  await client.receipt.update({
    where: { id: receiptId },
    data: {
      imageUrl: imagePath,
      imageName: imageName || current.imageName,
    },
  });
}

async function processDetailItems(params: {
  items: Array<{
    mark: string | null;
    orderNo: string | null;
    amount: number;
    receiptId: string | null;
  }>;
  currentUser: CurrentUser;
  imagePath: string | null;
  imageName: string | null;
  autoCreateNote: string;
  receiptMatchOptions?: FindMatchingReceiptOptions;
  requiredExplicitReceiptStatus?: ReceiptStatus;
  tx: DbTransactionClient;
}): Promise<{ items: DetailProcessedItem[]; touchedOrderIds: string[]; createdReceiptIds: string[] }> {
  const processedItems: DetailProcessedItem[] = [];
  const touchedOrderIds = new Set<string>();
  const usedReceiptIds = new Set<string>();
  const createdReceiptIds: string[] = [];

  for (const item of params.items) {
    let receiptId = item.receiptId;

    if (receiptId) {
      if (usedReceiptIds.has(receiptId)) {
        throw badRequest('同一张收据不能重复加入付款明细', { receiptId });
      }
      try {
        const receipt = await getAccessibleReceipt(receiptId, params.currentUser, params.tx);
        if (params.requiredExplicitReceiptStatus && receipt.status !== params.requiredExplicitReceiptStatus) {
          throw badRequest('只有SR_Received状态的收据可以加入新建付款明细', {
            receiptId,
            status: receipt.status,
          });
        }
        await maybeAttachReceiptImage(params.tx, receiptId, receipt, params.imagePath, params.imageName);
      } catch (error) {
        if (isApiError(error) && error.code === 'RESOURCE_NOT_FOUND' && item.orderNo) {
          receiptId = null;
        } else {
          throw error;
        }
      }
    }

    if (!receiptId && item.orderNo) {
      const autoMatchedReceiptId = await findMatchingReceipt(item.orderNo, item.amount, params.receiptMatchOptions);
      if (autoMatchedReceiptId) {
        if (usedReceiptIds.has(autoMatchedReceiptId)) {
          throw badRequest('同一张收据不能重复加入付款明细，请删除重复手动行', { receiptId: autoMatchedReceiptId });
        }
        const matchedReceipt = await getAccessibleReceipt(autoMatchedReceiptId, params.currentUser, params.tx);
        receiptId = autoMatchedReceiptId;
        await maybeAttachReceiptImage(params.tx, receiptId, matchedReceipt, params.imagePath, params.imageName);
      }
    }

    if (!receiptId && item.orderNo) {
      const orderId = await findOrCreateOrder(item.orderNo, params.currentUser.id, params.tx);
      const customerInfo = await resolveDetailItemCustomer(item.mark);
      const newReceipt = await params.tx.receipt.create({
        data: {
          orderNo: item.orderNo,
          usd: item.amount,
          status: ReceiptStatus.SR_Received,
          orderId,
          createdBy: params.currentUser.id,
          note: params.autoCreateNote,
          imageUrl: params.imagePath,
          imageName: params.imageName,
          customerId: customerInfo.customerId,
          customerMark: customerInfo.customerMark,
          customerName: customerInfo.customerName,
          customerPhone: customerInfo.customerPhone,
          customerCity: customerInfo.customerCity,
          needsCustomerFix: customerInfo.needsCustomerFix,
        },
      });
      receiptId = newReceipt.id;
      createdReceiptIds.push(newReceipt.id);
      touchedOrderIds.add(orderId);

      await params.tx.order.update({
        where: { id: orderId },
        data: {
          customerId: customerInfo.customerId,
          customerMark: customerInfo.customerMark,
          customerName: customerInfo.customerName,
          customerPhone: customerInfo.customerPhone,
          customerCity: customerInfo.customerCity,
          needsCustomerFix: customerInfo.needsCustomerFix,
        },
      });
    }

    processedItems.push({
      mark: item.mark,
      orderNo: item.orderNo,
      amount: item.amount,
      receiptId,
    });
    if (receiptId) {
      usedReceiptIds.add(receiptId);
    }
  }

  return {
    items: processedItems,
    touchedOrderIds: Array.from(touchedOrderIds),
    createdReceiptIds,
  };
}

function normalizeItems(payload: DetailPayload) {
  return payload.items.map((item) => ({
    mark: item.mark,
    orderNo: item.orderNo,
    amount: item.amount,
    receiptId: item.receiptId || item.matchedReceiptId || null,
  }));
}

async function setReceiptsWaitingSwift(tx: DbTransactionClient, receiptIds: string[]) {
  await setReceiptsStatus(tx, receiptIds, ReceiptStatus.Waiting_SWIFT);
}

async function setReceiptsStatus(tx: DbTransactionClient, receiptIds: string[], status: ReceiptStatus) {
  if (receiptIds.length === 0) return;
  await tx.receipt.updateMany({
    where: { id: { in: receiptIds } },
    data: { status },
  });
}

function getReceiptStatusAfterDetailUpdate(detailStatus: DetailStatus): ReceiptStatus {
  return detailStatus === DetailStatus.Bank_Transfer
    ? ReceiptStatus.Bank_Transfer
    : ReceiptStatus.Waiting_SWIFT;
}

async function applyDetailUpdate(params: {
  tx: DbTransactionClient | typeof db;
  currentUser: CurrentUser;
  detailId: string;
  payload: DetailPayload;
  imagePath?: string | null;
  imageName?: string | null;
  historyNote: string;
}) {
  const { tx, currentUser, detailId, payload, imagePath, imageName, historyNote } = params;

  const existingDetail = await tx.detail.findUnique({
    where: { id: detailId },
    include: { items: true },
  });
  if (!existingDetail) {
    throw createApiError({
      code: 'RESOURCE_NOT_FOUND',
      status: 400,
      message: '明细不存在',
      detail: { detailId },
    });
  }
  if (!(await canAccessOwnedResourceAsync(existingDetail.createdBy, currentUser))) {
    throw forbidden('无权修改该明细', {
      detailId,
      createdBy: existingDetail.createdBy,
    });
  }
  if (existingDetail.status === DetailStatus.RECEIVED) {
    throw badRequest('RECEIVED状态下禁止修改', { detailId, status: existingDetail.status });
  }

  const processedItems = await processDetailItems({
    items: normalizeItems(payload),
    currentUser,
    imagePath: imagePath || existingDetail.imageUrl || null,
    imageName: imageName || existingDetail.imageName || null,
    autoCreateNote: '由付款明细自动创建',
    receiptMatchOptions: {
      statuses: [ReceiptStatus.SR_Received, ReceiptStatus.Waiting_SWIFT, ReceiptStatus.Bank_Transfer],
      requireAmountTolerance: false,
    },
    tx,
  });
  await tx.detailHistory.create({
    data: {
      detailId,
      date: existingDetail.date,
      items: JSON.stringify(existingDetail.items),
      imageUrl: existingDetail.imageUrl,
      imageName: existingDetail.imageName,
      status: existingDetail.status,
      note: historyNote,
      createdBy: currentUser.id,
    },
  });

  await tx.detailItem.deleteMany({ where: { detailId } });
  const agentId = await resolveAccessiblePaymentAgentId(currentUser, payload.agentId ?? existingDetail.agentId);

  const nextDetail = await tx.detail.update({
    where: { id: detailId },
    data: {
      date: payload.date ? new Date(payload.date) : null,
      agentId,
      imageUrl: imagePath || existingDetail.imageUrl,
      imageName: imageName || existingDetail.imageName,
      totalAmount: processedItems.items.reduce((sum, item) => sum + item.amount, 0),
      items: {
        create: processedItems.items,
      },
    },
    include: {
      items: { include: { receipt: true } },
    },
  });

  const receiptIds = nextDetail.items
    .map((item) => item.receiptId)
    .filter((receiptId): receiptId is string => Boolean(receiptId));
  await setReceiptsStatus(tx as DbTransactionClient, receiptIds, getReceiptStatusAfterDetailUpdate(existingDetail.status));

  return { detail: nextDetail, touchedOrderIds: processedItems.touchedOrderIds };
}

export async function createDetailRecord(params: {
  currentUser: CurrentUser;
  payload: DetailPayload;
  imagePath?: string | null;
  imageName?: string | null;
  mode: 'confirm' | 'direct-create';
}) {
  const { currentUser, payload, imagePath, imageName, mode } = params;
  if (mode === 'confirm' && !payload.agentId) {
    throw badRequest('请选择付款代理');
  }

  const effectiveDate = payload.date
    ? new Date(payload.date)
    : (mode === 'direct-create'
      ? (() => {
          const serverToday = new Date();
          serverToday.setHours(0, 0, 0, 0);
          return serverToday;
        })()
      : null);

  const result = await runInTransaction(async (tx) => {
    const processedItems = await processDetailItems({
      items: normalizeItems(payload),
      currentUser,
      imagePath: imagePath || null,
      imageName: imageName || null,
      autoCreateNote: mode === 'direct-create' ? '由付款明细直接创建' : '由付款明细自动创建',
      requiredExplicitReceiptStatus: mode === 'direct-create' ? ReceiptStatus.SR_Received : undefined,
      tx,
    });
    const agentId = await resolveAccessiblePaymentAgentId(currentUser, payload.agentId);
    const created = await tx.detail.create({
      data: {
        date: effectiveDate,
        agentId,
        status: DetailStatus.Waiting_SWIFT,
        sourceMode: mode === 'direct-create' ? DetailSourceMode.DIRECT : DetailSourceMode.OCR,
        imageUrl: mode === 'direct-create' ? null : (imagePath || null),
        imageName: mode === 'direct-create' ? null : (imageName || null),
        totalAmount: processedItems.items.reduce((sum, item) => sum + item.amount, 0),
        createdBy: currentUser.id,
        items: {
          create: processedItems.items,
        },
      },
      include: {
        items: { include: { receipt: true } },
        creator: { select: { id: true, name: true, email: true } },
      },
    });

    const receiptIds = created.items
      .map((item) => item.receiptId)
      .filter((receiptId): receiptId is string => Boolean(receiptId));
    await setReceiptsWaitingSwift(tx, receiptIds);
    for (const receiptId of processedItems.createdReceiptIds) {
      await projectPaymentReceiptInTransaction(tx, {
        receiptId,
        actorId: currentUser.id,
      });
    }
    if (created.imageUrl) {
      await attachUploadedAssetByPath({
        client: tx,
        path: created.imageUrl,
        attachedType: UploadedAssetAttachmentType.DETAIL,
        attachedId: created.id,
      });
    }

    return { detail: created, touchedOrderIds: processedItems.touchedOrderIds };
  });

  for (const orderId of result.touchedOrderIds) {
    await updateOrderBalance(orderId);
  }

  try {
    const previewImage = await ensureDetailPreviewImage(result.detail.id);
    result.detail.imageUrl = previewImage.path;
    result.detail.imageName = previewImage.name;
  } catch (error) {
    logger.error('Ensure payment detail preview image failed', error);
  }

  await recordAuditEvent({
    action: mode === 'direct-create' ? auditActions.DETAIL_CREATE_DIRECT : auditActions.DETAIL_CREATE,
    actorId: currentUser.id,
    targetType: auditTargetTypes.DETAIL,
    targetId: result.detail.id,
  });

  return {
    data: result.detail,
    message: mode === 'direct-create' ? '付款明细已直接创建' : undefined,
  };
}

export async function updateDetailRecord(params: {
  currentUser: CurrentUser;
  detailId: string;
  payload: DetailPayload;
  imagePath?: string | null;
  imageName?: string | null;
  txClient?: DbTransactionClient | typeof db;
  skipAudit?: boolean;
  historyNote?: string;
}) {
  const { currentUser, detailId, payload, imagePath, imageName, txClient, skipAudit = false, historyNote = '重新识别前保存' } = params;
  if (!detailId) {
    throw badRequest('缺少明细ID');
  }

  const result = txClient
    ? await applyDetailUpdate({
        tx: txClient,
        currentUser,
        detailId,
        payload,
        imagePath,
        imageName,
        historyNote,
      })
    : await runInTransaction(async (tx) => applyDetailUpdate({
        tx,
        currentUser,
        detailId,
        payload,
        imagePath,
        imageName,
        historyNote,
      }));

  if (txClient) {
    for (const orderId of result.touchedOrderIds) {
      await updateOrderBalance(orderId, txClient as never);
    }
  } else {
    for (const orderId of result.touchedOrderIds) {
      await updateOrderBalance(orderId);
    }
  }

  if (!skipAudit) {
    await recordAuditEvent({
      action: auditActions.DETAIL_UPDATE,
      actorId: currentUser.id,
      targetType: auditTargetTypes.DETAIL,
      targetId: detailId,
    });
  }

  return { data: result.detail, touchedOrderIds: result.touchedOrderIds };
}
