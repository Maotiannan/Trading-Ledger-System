import { DetailStatus, ReceiptStatus, SwiftStatus, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { canAccessOwnedResourceAsync } from '@/lib/ownership';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { createApiError } from '@/lib/api-error';
import { runInTransaction, type DbTransactionClient } from '@/lib/transaction';
import { createOrder, ensureDepositPoolInvoice, findMatchingOrder, updateOrderBalance } from '@/lib/matching';
import { resolveCustomer } from '@/lib/customer-matching';
import { syncOrderAliases } from '@/lib/order-alias-db';
import type { CurrentUser } from '@/lib/request-auth';
import type { ReceiptPayload } from '@/lib/validators';

function badRequest(message: string, detail?: unknown) {
  return createApiError({ code: 'BAD_REQUEST', status: 400, message, detail });
}

function forbidden(message: string, detail?: unknown) {
  return createApiError({ code: 'FORBIDDEN', status: 403, message, detail });
}

async function createDepositOrder(tx: DbTransactionClient, params: {
  orderNo: string;
  usd: number;
  customerId: string | null;
  customerMark: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerCity: string | null;
  needsCustomerFix: boolean;
  currentUserId: string;
}): Promise<string> {
  const defaultInvoiceId = await ensureDepositPoolInvoice(params.currentUserId, tx);
  const depositOrder = await tx.order.create({
    data: {
      invoiceId: defaultInvoiceId,
      orderNo: params.orderNo,
      amount: 0,
      orderBalance: -params.usd,
      createdBy: params.currentUserId,
      customerId: params.customerId,
      customerMark: params.customerMark,
      customerName: params.customerName,
      customerPhone: params.customerPhone,
      customerCity: params.customerCity,
      needsCustomerFix: params.needsCustomerFix,
    },
  });
  await syncOrderAliases(tx, depositOrder.id, params.orderNo);
  return depositOrder.id;
}

export async function createReceiptRecord(params: {
  currentUser: CurrentUser;
  payload: ReceiptPayload;
  imagePath?: string | null;
  imageName?: string | null;
  mode: 'confirm' | 'direct-create';
}) {
  const { currentUser, payload, imagePath, imageName, mode } = params;
  const {
    customerMark,
    customerName,
    customerId,
    customerPhone,
    customerCity,
    receiptNo,
    orderNo,
    usd,
  } = payload;

  if (!customerMark || !customerMark.trim()) {
    throw badRequest('客户MARK不能为空');
  }

  if (receiptNo) {
    const existingReceipt = await db.receipt.findFirst({
      where: {
        receiptNo,
        createdBy: currentUser.id,
      },
      select: { id: true },
    });
    if (existingReceipt) {
      throw createApiError({
        code: 'CONFLICT',
        status: 400,
        message: '该收据号已存在于你的账户，请勿重复创建',
        detail: { receiptNo, existingReceiptId: existingReceipt.id },
      });
    }
  }

  const normalizedOrderNo = typeof orderNo === 'string' ? orderNo : null;
  const matchedOrder = await findMatchingOrder(normalizedOrderNo);
  const customerResolution = await resolveCustomer({
    customerMark,
    customerName: customerName || null,
    customerId: customerId || null,
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

  const receipt = await runInTransaction(async (tx) => {
    let orderId: string | null = matchedOrder?.orderId || null;
    if (payload.isDeposit && normalizedOrderNo && !matchedOrder) {
      orderId = await createDepositOrder(tx, {
        orderNo: normalizedOrderNo,
        usd,
        customerId: customerResolution.customerId,
        customerMark: customerResolution.customerMark,
        customerName: customerResolution.customerName,
        customerPhone: customerResolution.customerPhone,
        customerCity: customerResolution.customerCity,
        needsCustomerFix: customerResolution.needsCustomerFix,
        currentUserId: currentUser.id,
      });
    }

    if (!orderId && normalizedOrderNo) {
      orderId = await createOrder(normalizedOrderNo, currentUser.id, tx);
    }

    const created = await tx.receipt.create({
      data: {
        receiptNo: receiptNo?.trim() || null,
        date: effectiveDate,
        tel: payload.tel || null,
        usd,
        invNo: payload.invNo || null,
        orderNo: normalizedOrderNo,
        payer: payload.payer || null,
        customerId: customerResolution.customerId,
        customerMark: customerResolution.customerMark,
        customerName: customerResolution.customerName,
        customerPhone: customerResolution.customerPhone,
        customerCity: customerResolution.customerCity,
        needsCustomerFix: customerResolution.needsCustomerFix,
        isDeposit: payload.isDeposit || false,
        status: ReceiptStatus.SR_Received,
        imageUrl: imagePath || null,
        imageName: imageName || null,
        orderId,
        createdBy: currentUser.id,
      },
      include: {
        creator: { select: { id: true, name: true, email: true } },
      },
    });

    if (orderId) {
      await tx.order.update({
        where: { id: orderId },
        data: {
          customerId: customerResolution.customerId,
          customerMark: customerResolution.customerMark,
          customerName: customerResolution.customerName,
          customerPhone: customerResolution.customerPhone,
          customerCity: customerResolution.customerCity,
          needsCustomerFix: customerResolution.needsCustomerFix,
        },
      });
    }

    return { created, orderId };
  });

  if (receipt.orderId) {
    await updateOrderBalance(receipt.orderId);
  }

  await recordAuditEvent({
    action: auditActions.RECEIPT_CREATE,
    actorId: currentUser.id,
    targetType: auditTargetTypes.RECEIPT,
    targetId: receipt.created.id,
    metadata: { mode },
  });

  return {
    data: receipt.created,
    message: customerResolution.needsCustomerFix
      ? '请修复客户信息'
      : (mode === 'direct-create' ? '收据已直接创建' : undefined),
  };
}

export async function updateReceiptRecord(params: {
  currentUser: CurrentUser;
  receiptId: string;
  payload: ReceiptPayload;
  imagePath?: string | null;
  imageName?: string | null;
}) {
  const { currentUser, receiptId, payload, imagePath, imageName } = params;

  if (!receiptId) {
    throw badRequest('缺少收据ID');
  }

  const existingReceipt = await db.receipt.findUnique({
    where: { id: receiptId },
  });
  if (!existingReceipt) {
    throw createApiError({
      code: 'RESOURCE_NOT_FOUND',
      status: 400,
      message: '收据不存在',
      detail: { receiptId },
    });
  }
  if (!(await canAccessOwnedResourceAsync(existingReceipt.createdBy, currentUser))) {
    throw forbidden('无权修改该收据', {
      receiptId,
      createdBy: existingReceipt.createdBy,
    });
  }
  if (existingReceipt.status === ReceiptStatus.RECEIVED) {
    throw badRequest('RECEIVED状态下禁止修改', { receiptId, status: existingReceipt.status });
  }
  if (existingReceipt.status === ReceiptStatus.Bank_Transfer) {
    throw badRequest('Bank_Transfer状态下禁止修改', { receiptId, status: existingReceipt.status });
  }

  const matchedOrder = await findMatchingOrder(payload.orderNo);
  const customerResolution = payload.customerMark
    ? await resolveCustomer({
        customerMark: payload.customerMark,
        customerName: payload.customerName || null,
        customerId: payload.customerId || null,
      })
    : null;

  const updated = await runInTransaction(async (tx) => {
    await tx.receiptHistory.create({
      data: {
        receiptId,
        receiptNo: existingReceipt.receiptNo,
        date: existingReceipt.date,
        tel: existingReceipt.tel,
        usd: existingReceipt.usd,
        invNo: existingReceipt.invNo,
        orderNo: existingReceipt.orderNo,
        payer: existingReceipt.payer,
        imageUrl: existingReceipt.imageUrl,
        imageName: existingReceipt.imageName,
        status: existingReceipt.status,
        note: '重新识别前保存',
        createdBy: currentUser.id,
      },
    });

    return tx.receipt.update({
      where: { id: receiptId },
      data: {
        receiptNo: payload.receiptNo || null,
        date: payload.date ? new Date(payload.date) : null,
        tel: payload.tel || null,
        usd: payload.usd,
        invNo: payload.invNo || null,
        orderNo: payload.orderNo,
        payer: payload.payer || null,
        isDeposit: payload.isDeposit || false,
        customerId: customerResolution?.customerId ?? existingReceipt.customerId,
        customerMark: customerResolution?.customerMark ?? existingReceipt.customerMark,
        customerName: customerResolution?.customerName ?? existingReceipt.customerName,
        customerPhone: customerResolution?.customerPhone ?? existingReceipt.customerPhone,
        customerCity: customerResolution?.customerCity ?? existingReceipt.customerCity,
        needsCustomerFix: customerResolution?.needsCustomerFix ?? existingReceipt.needsCustomerFix,
        imageUrl: imagePath || existingReceipt.imageUrl,
        imageName: imageName || existingReceipt.imageName,
        orderId: matchedOrder?.orderId || existingReceipt.orderId,
      },
    });
  });

  if (existingReceipt.orderId) {
    await updateOrderBalance(existingReceipt.orderId);
  }
  if (matchedOrder && matchedOrder.orderId !== existingReceipt.orderId) {
    await updateOrderBalance(matchedOrder.orderId);
  }

  await recordAuditEvent({
    action: auditActions.RECEIPT_UPDATE,
    actorId: currentUser.id,
    targetType: auditTargetTypes.RECEIPT,
    targetId: receiptId,
  });

  return { data: updated };
}

export async function markReceiptReceived(params: {
  currentUser: CurrentUser;
  receiptId: string;
}) {
  const { currentUser, receiptId } = params;
  if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES) {
    throw forbidden('只有管理员和销售代表可以标记签收', {
      role: currentUser.role,
    });
  }
  if (!receiptId) {
    throw badRequest('缺少收据ID');
  }

  const existingReceipt = await db.receipt.findUnique({
    where: { id: receiptId },
  });
  if (!existingReceipt) {
    throw createApiError({
      code: 'RESOURCE_NOT_FOUND',
      status: 400,
      message: '收据不存在',
      detail: { receiptId },
    });
  }
  if (existingReceipt.status !== ReceiptStatus.Bank_Transfer) {
    throw badRequest('必须在Bank_Transfer状态后才能标记签收', {
      receiptId,
      status: existingReceipt.status,
    });
  }

  const updated = await runInTransaction(async (tx) => {
    const receipt = await tx.receipt.update({
      where: { id: receiptId },
      data: { status: ReceiptStatus.RECEIVED },
    });

    const detailItems = await tx.detailItem.findMany({
      where: { receiptId },
      include: { detail: { include: { items: { include: { receipt: true } } } } },
    });

    for (const item of detailItems) {
      if (!item.detail) continue;
      const allReceived = item.detail.items.every(
        (detailItem) => !detailItem.receipt || detailItem.receipt.status === ReceiptStatus.RECEIVED
      );
      if (allReceived) {
        await tx.detail.update({
          where: { id: item.detail.id },
          data: { status: DetailStatus.RECEIVED },
        });
        await tx.swift.updateMany({
          where: { detailId: item.detail.id },
          data: { status: SwiftStatus.RECEIVED },
        });
      }
    }

    return receipt;
  });

  await recordAuditEvent({
    action: auditActions.RECEIPT_MARK_RECEIVED,
    actorId: currentUser.id,
    targetType: auditTargetTypes.RECEIPT,
    targetId: receiptId,
  });

  return { data: updated };
}
