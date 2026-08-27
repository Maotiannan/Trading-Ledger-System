import { UserRole } from '@prisma/client';
import { createApiError } from '@/lib/api-error';
import { recordAuditEventInTransaction } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import {
  calculateLiveOrderBalance,
  updateOrderBalance,
} from '@/lib/order-balance-service';
import { SYSTEM_POOL_INVOICE_NOS } from '@/lib/payment-type-classifier';
import type { CurrentUser } from '@/lib/request-auth';
import type { DbTransactionClient } from '@/lib/transaction';

const MONEY_EPSILON = 0.005;

export type ReceiptEditTransferImpactInput = {
  receiptId: string;
  currentOrderId: string | null;
  nextOrderId: string | null;
  amount: number;
};

export type ReceiptEditTransferImpact = {
  balanceTransferId: string;
  generatedReceiptId: string;
  transferReceiptNo: string;
  sourceOrderId: string;
  sourceOrderNo: string;
  targetOrderId: string;
  targetOrderNo: string;
  amount: number;
};

export type ReverseBalanceTransferInput = {
  currentUser: CurrentUser;
  balanceTransferId: string;
  expectedGeneratedReceiptId: string;
  source: string;
};

export type BalanceTransferReversalResult = {
  balanceTransferId: string;
  generatedReceiptId: string;
  generatedReceiptNo: string;
  sourceOrderId: string;
  sourceOrderNo: string;
  targetOrderId: string;
  targetOrderNo: string;
  amount: number;
  sourceAmountBefore: number;
  sourceAmountAfter: number;
  sourceBalanceBefore: number;
  sourceBalanceAfter: number;
  targetBalanceBefore: number;
  targetBalanceAfter: number;
  sourceOrderDeleted: boolean;
};

type TransferInspectionClient = Pick<DbTransactionClient, 'balanceTransfer'>;

const transferInclude = {
  fromOrder: {
    select: {
      id: true,
      orderNo: true,
      amount: true,
      orderBalance: true,
      invoice: { select: { id: true, invNo: true } },
    },
  },
  toOrder: {
    select: {
      id: true,
      orderNo: true,
      amount: true,
      orderBalance: true,
      invoice: { select: { id: true, invNo: true } },
    },
  },
  generatedReceipt: {
    select: {
      id: true,
      receiptNo: true,
      usd: true,
      orderId: true,
      status: true,
      isMerged: true,
      mergedToId: true,
      detailItems: { select: { id: true } },
      histories: { select: { id: true } },
      editRequests: { select: { id: true } },
      generatorSession: { select: { id: true } },
    },
  },
} as const;

function conflict(message: string, detail?: unknown) {
  return createApiError({ code: 'CONFLICT', status: 409, message, detail });
}

function forbidden(message: string) {
  return createApiError({ code: 'FORBIDDEN', status: 403, message });
}

function notFound(message: string, detail?: unknown) {
  return createApiError({ code: 'RESOURCE_NOT_FOUND', status: 404, message, detail });
}

function isSameAmount(left: unknown, right: unknown): boolean {
  return Math.abs(Number(left) - Number(right)) < MONEY_EPSILON;
}

function assertValidGeneratedReceipt(transfer: {
  id: string;
  toOrderId: string;
  amount: unknown;
  generatedReceiptId: string | null;
  generatedReceipt: {
    id: string;
    receiptNo: string | null;
    usd: unknown;
    orderId: string | null;
    isMerged: boolean;
    mergedToId: string | null;
    detailItems: Array<{ id: string }>;
    histories: Array<{ id: string }>;
    editRequests: Array<{ id: string }>;
    generatorSession: { id: string } | null;
  } | null;
}) {
  const receipt = transfer.generatedReceipt;
  if (
    !transfer.generatedReceiptId
    || !receipt
    || receipt.id !== transfer.generatedReceiptId
    || !receipt.receiptNo?.startsWith('TRANSFER-')
    || receipt.orderId !== transfer.toOrderId
    || !isSameAmount(receipt.usd, transfer.amount)
  ) {
    throw conflict('余额转移记录与系统生成收据的关联不完整，无法安全撤销', {
      balanceTransferId: transfer.id,
      generatedReceiptId: transfer.generatedReceiptId,
    });
  }
  return receipt;
}

function assertGeneratedReceiptHasNoProtectedReferences(receipt: {
  id: string;
  isMerged: boolean;
  mergedToId: string | null;
  detailItems: Array<{ id: string }>;
  histories: Array<{ id: string }>;
  editRequests: Array<{ id: string }>;
  generatorSession: { id: string } | null;
}) {
  if (
    receipt.isMerged
    || receipt.mergedToId
    || receipt.detailItems.length > 0
    || receipt.histories.length > 0
    || receipt.editRequests.length > 0
    || receipt.generatorSession
  ) {
    throw conflict('该转移收据已被其他业务记录引用，无法自动撤销', {
      generatedReceiptId: receipt.id,
    });
  }
}

export async function inspectReceiptEditTransferImpact(
  tx: TransferInspectionClient,
  input: ReceiptEditTransferImpactInput,
): Promise<ReceiptEditTransferImpact | null> {
  if (
    !input.currentOrderId
    || !input.nextOrderId
    || input.currentOrderId === input.nextOrderId
  ) {
    return null;
  }

  const candidates = await tx.balanceTransfer.findMany({
    where: {
      fromOrderId: input.currentOrderId,
      toOrderId: input.nextOrderId,
      amount: input.amount,
    },
    include: transferInclude,
  });

  if (candidates.length === 0) return null;
  if (candidates.length !== 1) {
    throw conflict('检测到多条相同的余额转移记录，无法自动判断应撤销哪一条', {
      receiptId: input.receiptId,
      balanceTransferIds: candidates.map((candidate) => candidate.id),
    });
  }

  const transfer = candidates[0];
  const generatedReceipt = assertValidGeneratedReceipt(transfer);
  if (generatedReceipt.id === input.receiptId) {
    throw conflict('系统转移收据不能作为原始收据重新绑定');
  }

  return {
    balanceTransferId: transfer.id,
    generatedReceiptId: generatedReceipt.id,
    transferReceiptNo: generatedReceipt.receiptNo!,
    sourceOrderId: transfer.fromOrderId,
    sourceOrderNo: transfer.fromOrder.orderNo,
    targetOrderId: transfer.toOrderId,
    targetOrderNo: transfer.toOrder.orderNo,
    amount: Number(transfer.amount),
  };
}

async function cleanupSafeSystemPoolSourceOrder(
  tx: DbTransactionClient,
  sourceOrderId: string,
): Promise<boolean> {
  const sourceOrder = await tx.order.findUnique({
    where: { id: sourceOrderId },
    select: {
      id: true,
      amount: true,
      orderBalance: true,
      invoice: { select: { id: true, invNo: true } },
      receipts: { select: { id: true }, take: 1 },
      mergedReceipts: { select: { id: true }, take: 1 },
      orderTrackers: { select: { id: true }, take: 1 },
      balanceTransfersFrom: { select: { id: true }, take: 1 },
      balanceTransfersTo: { select: { id: true }, take: 1 },
    },
  });

  if (!sourceOrder || !SYSTEM_POOL_INVOICE_NOS.has(sourceOrder.invoice.invNo)) return false;

  const isEmpty = Math.abs(Number(sourceOrder.amount)) < MONEY_EPSILON
    && Math.abs(Number(sourceOrder.orderBalance)) < MONEY_EPSILON
    && sourceOrder.receipts.length === 0
    && sourceOrder.mergedReceipts.length === 0
    && sourceOrder.orderTrackers.length === 0
    && sourceOrder.balanceTransfersFrom.length === 0
    && sourceOrder.balanceTransfersTo.length === 0;

  if (!isEmpty) return false;
  await tx.order.delete({ where: { id: sourceOrderId } });
  return true;
}

export async function reverseBalanceTransferInTransaction(
  tx: DbTransactionClient,
  input: ReverseBalanceTransferInput,
): Promise<BalanceTransferReversalResult> {
  if (input.currentUser.role !== UserRole.ADMIN) {
    throw forbidden('仅管理员可以撤销余额转移');
  }

  const transfer = await tx.balanceTransfer.findUnique({
    where: { id: input.balanceTransferId },
    include: transferInclude,
  });
  if (!transfer) {
    throw notFound('余额转移记录不存在或已经撤销', {
      balanceTransferId: input.balanceTransferId,
    });
  }

  const generatedReceipt = assertValidGeneratedReceipt(transfer);
  if (generatedReceipt.id !== input.expectedGeneratedReceiptId) {
    throw conflict('余额转移关联已发生变化，请刷新后重试', {
      balanceTransferId: transfer.id,
      expectedGeneratedReceiptId: input.expectedGeneratedReceiptId,
      actualGeneratedReceiptId: generatedReceipt.id,
    });
  }
  assertGeneratedReceiptHasNoProtectedReferences(generatedReceipt);

  const transferAmount = Number(transfer.amount);
  const sourceAmountBefore = Number(transfer.fromOrder.amount);
  if (sourceAmountBefore + MONEY_EPSILON < transferAmount) {
    throw conflict('源订单金额已发生变化，撤销后会产生负数，操作已停止', {
      sourceOrderId: transfer.fromOrderId,
      sourceAmountBefore,
      transferAmount,
    });
  }

  const [sourceBalanceBefore, targetBalanceBefore] = await Promise.all([
    calculateLiveOrderBalance(transfer.fromOrderId, tx),
    calculateLiveOrderBalance(transfer.toOrderId, tx),
  ]);

  const claim = await tx.balanceTransfer.deleteMany({
    where: {
      id: transfer.id,
      generatedReceiptId: generatedReceipt.id,
    },
  });
  if (claim.count !== 1) {
    throw conflict('余额转移已被其他操作撤销，请刷新后查看最新数据', {
      balanceTransferId: transfer.id,
    });
  }

  await tx.receipt.delete({ where: { id: generatedReceipt.id } });
  await tx.order.update({
    where: { id: transfer.fromOrderId },
    data: { amount: { decrement: transferAmount } },
  });

  const sourceBalanceResult = await updateOrderBalance(transfer.fromOrderId, tx, {
    actorId: input.currentUser.id,
    source: input.source,
  });
  const targetBalanceResult = await updateOrderBalance(transfer.toOrderId, tx, {
    actorId: input.currentUser.id,
    source: input.source,
  });
  const sourceAmountAfter = sourceAmountBefore - transferAmount;
  const sourceOrderDeleted = SYSTEM_POOL_INVOICE_NOS.has(transfer.fromOrder.invoice.invNo)
    ? await cleanupSafeSystemPoolSourceOrder(tx, transfer.fromOrderId)
    : false;

  const result: BalanceTransferReversalResult = {
    balanceTransferId: transfer.id,
    generatedReceiptId: generatedReceipt.id,
    generatedReceiptNo: generatedReceipt.receiptNo!,
    sourceOrderId: transfer.fromOrderId,
    sourceOrderNo: transfer.fromOrder.orderNo,
    targetOrderId: transfer.toOrderId,
    targetOrderNo: transfer.toOrder.orderNo,
    amount: transferAmount,
    sourceAmountBefore,
    sourceAmountAfter,
    sourceBalanceBefore,
    sourceBalanceAfter: sourceBalanceResult.computed,
    targetBalanceBefore,
    targetBalanceAfter: targetBalanceResult.computed,
    sourceOrderDeleted,
  };

  await recordAuditEventInTransaction(tx, {
    action: auditActions.ORDER_TRANSFER_BALANCE_REVERSE,
    actorId: input.currentUser.id,
    targetType: auditTargetTypes.BALANCE_TRANSFER,
    targetId: transfer.id,
    metadata: {
      ...result,
      source: input.source,
    },
  });

  return result;
}
