import { DetailStatus, ReceiptStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { canAccessOwnedResourceAsync } from '@/lib/ownership';
import { recordAuditEvent } from '@/lib/audit';
import { createApiError } from '@/lib/api-error';
import { runInTransaction, type DbTransactionClient } from '@/lib/transaction';
import { findMatchingReceipt, findOrCreateOrder, updateOrderBalance } from '@/lib/matching';
import { resolveCustomer } from '@/lib/customer-matching';
import type { CurrentUser } from '@/lib/request-auth';
import type { DetailPayload } from '@/lib/validators';

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

async function getAccessibleReceipt(receiptId: string, currentUser: CurrentUser) {
  const receipt = await db.receipt.findUnique({
    where: { id: receiptId },
    select: { id: true, createdBy: true, imageUrl: true, imageName: true },
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
  return receipt;
}

async function maybeAttachReceiptImage(
  receiptId: string,
  current: { imageUrl: string | null; imageName: string | null },
  imagePath: string | null,
  imageName: string | null
): Promise<void> {
  if (!imagePath || current.imageUrl) return;
  await db.receipt.update({
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
}): Promise<DetailProcessedItem[]> {
  const processedItems: DetailProcessedItem[] = [];

  for (const item of params.items) {
    let receiptId = item.receiptId;

    if (receiptId) {
      const receipt = await getAccessibleReceipt(receiptId, params.currentUser);
      await maybeAttachReceiptImage(receiptId, receipt, params.imagePath, params.imageName);
    }

    if (!receiptId && item.orderNo) {
      const autoMatchedReceiptId = await findMatchingReceipt(item.orderNo, item.amount);
      if (autoMatchedReceiptId) {
        const matchedReceipt = await getAccessibleReceipt(autoMatchedReceiptId, params.currentUser);
        receiptId = autoMatchedReceiptId;
        await maybeAttachReceiptImage(receiptId, matchedReceipt, params.imagePath, params.imageName);
      }
    }

    if (!receiptId && item.orderNo) {
      const orderId = await findOrCreateOrder(item.orderNo, params.currentUser.id);
      const customerInfo = await resolveDetailItemCustomer(item.mark);
      const newReceipt = await db.receipt.create({
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

      await db.order.update({
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
      await updateOrderBalance(orderId);
    }

    processedItems.push({
      mark: item.mark,
      orderNo: item.orderNo,
      amount: item.amount,
      receiptId,
    });
  }

  return processedItems;
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
  if (receiptIds.length === 0) return;
  await tx.receipt.updateMany({
    where: { id: { in: receiptIds } },
    data: { status: ReceiptStatus.Waiting_SWIFT },
  });
}

export async function createDetailRecord(params: {
  currentUser: CurrentUser;
  payload: DetailPayload;
  imagePath?: string | null;
  imageName?: string | null;
  mode: 'confirm' | 'direct-create';
}) {
  const { currentUser, payload, imagePath, imageName, mode } = params;
  const processedItems = await processDetailItems({
    items: normalizeItems(payload),
    currentUser,
    imagePath: imagePath || null,
    imageName: imageName || null,
    autoCreateNote: mode === 'direct-create' ? '由付款明细直接创建' : '由付款明细自动创建',
  });

  const effectiveDate = payload.date
    ? new Date(payload.date)
    : (mode === 'direct-create'
      ? (() => {
          const serverToday = new Date();
          serverToday.setHours(0, 0, 0, 0);
          return serverToday;
        })()
      : null);

  const detail = await runInTransaction(async (tx) => {
    const created = await tx.detail.create({
      data: {
        date: effectiveDate,
        status: DetailStatus.Waiting_SWIFT,
        imageUrl: mode === 'direct-create' ? null : (imagePath || null),
        imageName: mode === 'direct-create' ? null : (imageName || null),
        totalAmount: processedItems.reduce((sum, item) => sum + item.amount, 0),
        createdBy: currentUser.id,
        items: {
          create: processedItems,
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

    return created;
  });

  await recordAuditEvent({
    action: mode === 'direct-create' ? 'DETAIL_CREATE_DIRECT' : 'DETAIL_CREATE',
    actorId: currentUser.id,
    targetType: 'DETAIL',
    targetId: detail.id,
  });

  return {
    data: detail,
    message: mode === 'direct-create' ? '付款明细已直接创建' : undefined,
  };
}

export async function updateDetailRecord(params: {
  currentUser: CurrentUser;
  detailId: string;
  payload: DetailPayload;
  imagePath?: string | null;
  imageName?: string | null;
}) {
  const { currentUser, detailId, payload, imagePath, imageName } = params;
  if (!detailId) {
    throw badRequest('缺少明细ID');
  }

  const existingDetail = await db.detail.findUnique({
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
  if (existingDetail.status === DetailStatus.Bank_Transfer) {
    throw badRequest('Bank_Transfer状态下禁止修改', { detailId, status: existingDetail.status });
  }

  const processedItems = await processDetailItems({
    items: normalizeItems(payload),
    currentUser,
    imagePath: imagePath || existingDetail.imageUrl || null,
    imageName: imageName || existingDetail.imageName || null,
    autoCreateNote: '由付款明细自动创建',
  });

  const updated = await runInTransaction(async (tx) => {
    await tx.detailHistory.create({
      data: {
        detailId,
        date: existingDetail.date,
        items: JSON.stringify(existingDetail.items),
        imageUrl: existingDetail.imageUrl,
        imageName: existingDetail.imageName,
        status: existingDetail.status,
        note: '重新识别前保存',
        createdBy: currentUser.id,
      },
    });

    await tx.detailItem.deleteMany({ where: { detailId } });

    const nextDetail = await tx.detail.update({
      where: { id: detailId },
      data: {
        date: payload.date ? new Date(payload.date) : null,
        imageUrl: imagePath || existingDetail.imageUrl,
        imageName: imageName || existingDetail.imageName,
        totalAmount: processedItems.reduce((sum, item) => sum + item.amount, 0),
        items: {
          create: processedItems,
        },
      },
      include: {
        items: { include: { receipt: true } },
      },
    });

    const receiptIds = nextDetail.items
      .map((item) => item.receiptId)
      .filter((receiptId): receiptId is string => Boolean(receiptId));
    await setReceiptsWaitingSwift(tx, receiptIds);

    return nextDetail;
  });

  await recordAuditEvent({
    action: 'DETAIL_UPDATE',
    actorId: currentUser.id,
    targetType: 'DETAIL',
    targetId: detailId,
  });

  return { data: updated };
}
