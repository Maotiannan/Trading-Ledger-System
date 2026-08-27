import { ReceiptStatus } from '@prisma/client';
import { createApiError } from '@/lib/api-error';
import { recordAuditEventInTransaction } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import {
  cleanupSafeSystemPoolSourceOrderInTransaction,
  inspectReceiptEditTransferImpact,
  reverseBalanceTransferInTransaction,
} from '@/lib/balance-transfer-reversal-service';
import { updateOrderBalance } from '@/lib/order-balance-service';
import {
  resolveReceiptEditBinding,
  syncReceiptDetailItemsForBinding,
} from '@/lib/receipt-edit-binding';
import type { ReceiptEditablePatch } from '@/lib/receipt-edit-types';
import { syncPendingReceiptGeneratorDraft } from '@/lib/receipt-generator-draft-service';
import type { CurrentUser } from '@/lib/request-auth';
import type { DbTransactionClient } from '@/lib/transaction';

export type ApplyReceiptEditInput = {
  tx: DbTransactionClient;
  currentUser: CurrentUser;
  ownerIds: string[];
  receiptId: string;
  patch: ReceiptEditablePatch;
  nextDate: Date | null;
  historyNote: string;
  source: string;
  expectedBalanceTransferId?: string | null;
};

export type ApplyReceiptEditResult = {
  receipt: Awaited<ReturnType<DbTransactionClient['receipt']['update']>>;
  touchedOrderIds: string[];
  reversedTransferId: string | null;
};

function badRequest(message: string, detail?: unknown) {
  return createApiError({ code: 'BAD_REQUEST', status: 400, message, detail });
}

function conflict(message: string, detail?: unknown) {
  return createApiError({ code: 'CONFLICT', status: 409, message, detail });
}

function transferReversalRequired(impact: Awaited<ReturnType<typeof inspectReceiptEditTransferImpact>>) {
  if (!impact) throw new Error('Transfer impact is required');
  return createApiError({
    code: 'RECEIPT_EDIT_TRANSFER_REVERSAL_REQUIRED',
    status: 409,
    message: '该收据已发生余额转移。请确认撤销转移后再修改收据。',
    detail: {
      balanceTransferId: impact.balanceTransferId,
      transferReceiptNo: impact.transferReceiptNo,
      sourceOrderNo: impact.sourceOrderNo,
      targetOrderNo: impact.targetOrderNo,
      amount: impact.amount,
    },
  });
}

export async function applyReceiptEditInTransaction(
  input: ApplyReceiptEditInput,
): Promise<ApplyReceiptEditResult> {
  const {
    tx,
    currentUser,
    ownerIds,
    receiptId,
    patch,
    nextDate,
    historyNote,
    source,
    expectedBalanceTransferId,
  } = input;

  const existingReceipt = await tx.receipt.findUnique({ where: { id: receiptId } });
  if (!existingReceipt) {
    throw createApiError({
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
      message: '收据不存在',
      detail: { receiptId },
    });
  }
  if (existingReceipt.status === ReceiptStatus.Bank_Transfer) {
    throw badRequest('Bank_Transfer状态下禁止修改', {
      receiptId,
      status: existingReceipt.status,
    });
  }

  const binding = await resolveReceiptEditBinding(tx, {
    currentUserId: currentUser.id,
    ownerIds,
    orderNo: patch.orderNo,
    invNo: patch.invNo,
    isDeposit: existingReceipt.isDeposit,
    customerId: existingReceipt.customerId,
    customerMark: patch.customerMark || existingReceipt.customerMark,
    customerName: existingReceipt.customerName,
    customerPhone: existingReceipt.customerPhone,
    customerCity: existingReceipt.customerCity,
    needsCustomerFix: existingReceipt.needsCustomerFix,
  });

  const transferImpact = await inspectReceiptEditTransferImpact(tx, {
    receiptId,
    currentOrderId: existingReceipt.orderId || null,
    nextOrderId: binding.orderId,
    amount: Number(existingReceipt.usd),
  });
  if (transferImpact && !expectedBalanceTransferId) {
    throw transferReversalRequired(transferImpact);
  }
  if (transferImpact && transferImpact.balanceTransferId !== expectedBalanceTransferId) {
    throw conflict('余额转移信息已变化，请刷新后重新确认', {
      expectedBalanceTransferId,
      actualBalanceTransferId: transferImpact.balanceTransferId,
    });
  }
  if (!transferImpact && expectedBalanceTransferId) {
    throw conflict('原余额转移已不存在或收据目标已变化，请刷新后重试', {
      expectedBalanceTransferId,
    });
  }

  if (transferImpact) {
    await reverseBalanceTransferInTransaction(tx, {
      currentUser,
      ownerIds,
      balanceTransferId: transferImpact.balanceTransferId,
      expectedGeneratedReceiptId: transferImpact.generatedReceiptId,
      source,
      deferSourceCleanup: true,
    });
  }

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
      note: historyNote,
      createdBy: currentUser.id,
    },
  });

  const nextCustomerMark = patch.customerMark || null;
  const matchedCustomer = binding.matchedCustomer
    && binding.matchedCustomer.customerId
    && !binding.matchedCustomer.needsCustomerFix
    ? binding.matchedCustomer
    : null;
  const updatedReceipt = await tx.receipt.update({
    where: { id: receiptId },
    data: {
      receiptNo: patch.receiptNo || null,
      date: nextDate,
      tel: patch.tel || null,
      invNo: binding.invNo,
      orderNo: binding.orderNo,
      orderId: binding.orderId,
      customerMark: nextCustomerMark,
      payer: patch.payer || null,
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
    receiptId,
    orderNo: binding.orderNo,
    customerMark: nextCustomerMark,
  });
  await syncPendingReceiptGeneratorDraft(tx, {
    receiptId,
    status: existingReceipt.status,
    receiptNo: patch.receiptNo || null,
    date: nextDate,
    orderId: binding.orderId,
    orderNo: binding.orderNo,
    invNo: binding.invNo,
    customerId: matchedCustomer?.customerId || existingReceipt.customerId,
    customerMark: nextCustomerMark,
    customerName: matchedCustomer?.customerName || existingReceipt.customerName,
    payer: patch.payer || null,
    tel: patch.tel || null,
  });

  const touchedOrderIds = Array.from(new Set([
    existingReceipt.orderId || null,
    binding.orderId,
  ].filter((orderId): orderId is string => Boolean(orderId))));
  if (existingReceipt.orderId !== binding.orderId) {
    for (const orderId of touchedOrderIds) {
      await updateOrderBalance(orderId, tx, {
        actorId: currentUser.id,
        source,
      });
    }
  }
  if (transferImpact) {
    await cleanupSafeSystemPoolSourceOrderInTransaction(tx, transferImpact.sourceOrderId);
  }

  await recordAuditEventInTransaction(tx, {
    action: transferImpact
      ? auditActions.RECEIPT_UPDATE_WITH_TRANSFER_REVERSAL
      : auditActions.RECEIPT_UPDATE,
    actorId: currentUser.id,
    targetType: auditTargetTypes.RECEIPT,
    targetId: receiptId,
    metadata: {
      source,
      previousOrderId: existingReceipt.orderId || null,
      nextOrderId: binding.orderId,
      balanceTransferId: transferImpact?.balanceTransferId || null,
    },
  });

  return {
    receipt: updatedReceipt,
    touchedOrderIds,
    reversedTransferId: transferImpact?.balanceTransferId || null,
  };
}
