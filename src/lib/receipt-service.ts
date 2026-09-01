import { DetailStatus, ReceiptStatus, SwiftStatus, UploadedAssetAttachmentType, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { canAccessOwnedResourceAsync } from '@/lib/ownership';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { createApiError } from '@/lib/api-error';
import { buildReceiptVisibilityWhere } from '@/lib/resource-visibility';
import { runInTransaction, type DbTransactionClient } from '@/lib/transaction';
import { createOrder, ensureDepositPoolInvoice, findMatchingOrder, updateOrderBalance } from '@/lib/matching';
import { resolveCustomer } from '@/lib/customer-matching';
import { formatCustomerPayerLabel } from '@/lib/customer-display';
import { syncOrderAliases } from '@/lib/order-alias-db';
import type { ReceiptEditablePatch } from '@/lib/receipt-edit-types';
import { applyReceiptEditInTransaction } from '@/lib/receipt-edit-apply-service';
import type { CurrentUser } from '@/lib/request-auth';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import type { ReceiptPayload } from '@/lib/validators';
import { attachUploadedAssetByPath } from '@/lib/uploaded-asset-service';
import { projectPaymentReceiptInTransaction } from '@/lib/email/email-notification-projector';

function badRequest(message: string, detail?: unknown) {
  return createApiError({ code: 'BAD_REQUEST', status: 400, message, detail });
}

function forbidden(message: string, detail?: unknown) {
  return createApiError({ code: 'FORBIDDEN', status: 403, message, detail });
}

function isReceiptNoUniqueError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== 'P2002') return false;
  const target = candidate.meta?.target;
  return Array.isArray(target)
    ? target.includes('receiptNo')
    : String(target || '').includes('receiptNo');
}

function receiptNoConflict(receiptNo: string | null | undefined) {
  const normalizedReceiptNo = receiptNo?.trim() || null;
  return createApiError({
    code: 'CONFLICT',
    status: 409,
    message: normalizedReceiptNo
      ? `收据号 ${normalizedReceiptNo} 已存在，请换一个编号`
      : '收据号已存在，请换一个编号',
    detail: { receiptNo: normalizedReceiptNo },
  });
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

async function getReceiptOwnerVisibleIds(currentUser: CurrentUser): Promise<string[]> {
  const scope = await getHierarchyScope(currentUser);
  return Array.from(scope.ownerVisibleIds);
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
  const effectiveOrderNo = matchedOrder?.orderNo || normalizedOrderNo;
  const customerResolution = await resolveCustomer({
    customerMark,
    customerName: customerName || null,
    customerId: customerId || null,
    customerOrderNo: effectiveOrderNo,
  });
  const effectiveInvNo = matchedOrder ? (payload.invNo || null) : null;
  const effectivePayer = formatCustomerPayerLabel({
    name: customerResolution.customerPayerName,
    mark: customerResolution.customerMark,
  }) || (payload.payer || null);

  const effectiveDate = payload.date
    ? new Date(payload.date)
    : (mode === 'direct-create'
      ? (() => {
          const serverToday = new Date();
          serverToday.setHours(0, 0, 0, 0);
          return serverToday;
        })()
      : null);

  let receipt;
  try {
    receipt = await runInTransaction(async (tx) => {
      let orderId: string | null = matchedOrder?.orderId || null;
      if (payload.isDeposit && effectiveOrderNo && !matchedOrder) {
        orderId = await createDepositOrder(tx, {
          orderNo: effectiveOrderNo,
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

      if (!orderId && effectiveOrderNo) {
        orderId = await createOrder(effectiveOrderNo, currentUser.id, tx);
      }

      const created = await tx.receipt.create({
        data: {
          receiptNo: receiptNo?.trim() || null,
          date: effectiveDate,
          tel: payload.tel || null,
          usd,
          invNo: effectiveInvNo,
          orderNo: effectiveOrderNo,
          payer: effectivePayer,
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
      if (created.imageUrl) {
        await attachUploadedAssetByPath({
          client: tx,
          path: created.imageUrl,
          attachedType: UploadedAssetAttachmentType.RECEIPT,
          attachedId: created.id,
        });
      }
      await projectPaymentReceiptInTransaction(tx, {
        receiptId: created.id,
        actorId: currentUser.id,
      });

      return { created, orderId };
    });
  } catch (error) {
    if (isReceiptNoUniqueError(error)) {
      throw receiptNoConflict(receiptNo);
    }
    throw error;
  }

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
  payload: ReceiptEditablePatch;
  imagePath?: string | null;
  imageName?: string | null;
  expectedBalanceTransferId?: string | null;
}) {
  const {
    currentUser,
    receiptId,
    payload,
    imagePath,
    imageName,
    expectedBalanceTransferId,
  } = params;
  void imagePath;
  void imageName;

  if (currentUser.role !== UserRole.ADMIN) {
    throw forbidden('只有管理员可以直接修改收据', {
      role: currentUser.role,
      receiptId,
    });
  }
  if (!receiptId) {
    throw badRequest('缺少收据ID');
  }
  const nextDate = parseEditableDateValue(payload.date);

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
  const ownerVisibleIds = await getReceiptOwnerVisibleIds(currentUser);
  const visibleReceipt = await db.receipt.findFirst({
    where: {
      AND: [
        { id: receiptId },
        buildReceiptVisibilityWhere(ownerVisibleIds),
      ],
    },
    select: { id: true },
  });
  if (!visibleReceipt) {
    throw forbidden('无权修改该收据', {
      receiptId,
      ownerVisibleIds,
    });
  }
  if (existingReceipt.status === ReceiptStatus.Bank_Transfer) {
    throw badRequest('Bank_Transfer状态下禁止修改', { receiptId, status: existingReceipt.status });
  }

  let applied;
  try {
    applied = await runInTransaction((tx) => applyReceiptEditInTransaction({
      tx,
      currentUser,
      ownerIds: ownerVisibleIds,
      receiptId,
      patch: payload,
      nextDate,
      historyNote: '重新识别前保存',
      source: 'DIRECT_ADMIN_EDIT',
      expectedBalanceTransferId,
    }));
  } catch (error) {
    if (isReceiptNoUniqueError(error)) {
      throw receiptNoConflict(payload.receiptNo);
    }
    throw error;
  }

  return { data: applied.receipt };
}

export async function markReceiptReceived(params: {
  currentUser: CurrentUser;
  receiptId: string;
}) {
  const { currentUser, receiptId } = params;
  if (currentUser.role !== UserRole.ADMIN) {
    throw forbidden('只有管理员可以确认收据完成', {
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
  if (!(await canAccessOwnedResourceAsync(existingReceipt.createdBy, currentUser))) {
    throw forbidden('无权确认该收据完成', {
      receiptId,
      createdBy: existingReceipt.createdBy,
    });
  }
  if (existingReceipt.status === ReceiptStatus.RECEIVED) {
    throw badRequest('收据已完成，无需重复确认', {
      receiptId,
      status: existingReceipt.status,
    });
  }
  if (existingReceipt.status === ReceiptStatus.SIGNING_PENDING) {
    throw badRequest('签名未完成的收据不能进入业务流程', {
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
