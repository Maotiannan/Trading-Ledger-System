import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { recordAuditEvent, recordAuditEventInTransaction } from '@/lib/audit';
import { db } from '@/lib/db';
import { runFinancialTransaction as runInTransaction } from '@/lib/transaction';
import { lockOrderBalances } from '@/lib/order-balance-lock';
import { createApiError } from '@/lib/api-error';
import { logger } from '@/lib/logger';
import type { DbTransactionClient } from '@/lib/transaction';
import {
  compareStoredOrderBalance,
  computeOrderBalanceFromReceipts,
  type OrderBalanceComparison,
  type OrderBalanceReceiptInput,
} from '@/lib/order-balance';
import type { MoneyInput } from '@/lib/money';
import { receiptBalanceSelect, paymentAllocationsSelect } from '@/lib/prepayments/balance-select';
import type { OrderPaymentAllocationInput } from '@/lib/order-balance';

export type OrderBalanceClient = Pick<DbTransactionClient, 'order'> & Partial<Pick<DbTransactionClient, '$queryRaw' | 'auditLog'>>;

export type OrderBalanceRow = {
  id: string;
  orderNo?: string | null;
  amount: MoneyInput;
  orderBalance?: MoneyInput;
  receipts?: OrderBalanceReceiptInput[] | null;
  paymentAllocations?: OrderPaymentAllocationInput[] | null;
};

export type OrderBalanceUpdateOptions = {
  actorId?: string | null;
  source?: string;
};

export type OrderBalanceRepairResult = {
  repaired: boolean;
  comparison: OrderBalanceComparison;
  stored: number;
  computed: number;
  difference: number;
};

const DEFAULT_BALANCE_SOURCE = 'order-balance-service';

async function loadOrderBalanceRow(orderId: string, client: OrderBalanceClient): Promise<OrderBalanceRow | null> {
  return client.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNo: true,
      amount: true,
      orderBalance: true,
      receipts: { select: receiptBalanceSelect },
      paymentAllocations: paymentAllocationsSelect,
    },
  }) as Promise<OrderBalanceRow | null>;
}

function computeComparison(row: OrderBalanceRow): OrderBalanceComparison {
  const computed = computeOrderBalanceFromReceipts({
    amount: row.amount,
    receipts: row.receipts || [],
    paymentAllocations: row.paymentAllocations,
  });

  return compareStoredOrderBalance({
    stored: row.orderBalance || 0,
    computed,
  });
}

async function writeBalanceRepairAudit(row: OrderBalanceRow, comparison: OrderBalanceComparison, options: OrderBalanceUpdateOptions, client: OrderBalanceClient) {
  if (!options.actorId) return;

  const event = {
      action: auditActions.ORDER_BALANCE_CACHE_REPAIR,
      actorId: options.actorId,
      targetType: auditTargetTypes.ORDER,
      targetId: row.id,
      metadata: {
        orderNo: row.orderNo || null,
        before: comparison.stored,
        after: comparison.computed,
        difference: comparison.difference,
        source: options.source || DEFAULT_BALANCE_SOURCE,
      },
    };
  if (client.auditLog) await recordAuditEventInTransaction({ auditLog: { create: (input) => client.auditLog!.create(input) } }, event);
  else await recordAuditEvent(event);
}

export async function calculateLiveOrderBalance(
  orderId: string,
  client: OrderBalanceClient = db,
): Promise<number> {
  const row = await loadOrderBalanceRow(orderId, client);
  if (!row) return 0;
  return computeComparison(row).computed;
}

export async function updateOrderBalance(
  orderId: string,
  client: OrderBalanceClient = db,
  options: OrderBalanceUpdateOptions = {},
): Promise<OrderBalanceRepairResult> {
  if (client === db) return runInTransaction(async (tx) => {
    await lockOrderBalances(tx, [orderId]);
    return updateOrderBalance(orderId, tx, options);
  });
  if (client.$queryRaw) await lockOrderBalances(client as DbTransactionClient, [orderId]);
  const row = await loadOrderBalanceRow(orderId, client);
  if (!row) {
    const comparison = compareStoredOrderBalance({ stored: 0, computed: 0 });
    return { repaired: false, comparison, stored: comparison.stored, computed: comparison.computed, difference: comparison.difference };
  }

  const comparison = computeComparison(row);
  if (comparison.matches) {
    return { repaired: false, comparison, stored: comparison.stored, computed: comparison.computed, difference: comparison.difference };
  }

  await client.order.update({
    where: { id: row.id },
    data: { orderBalance: comparison.computed },
  });

  logger.info('Order balance cache updated', {
    orderId: row.id,
    orderNo: row.orderNo || null,
    source: options.source || DEFAULT_BALANCE_SOURCE,
    before: comparison.stored,
    after: comparison.computed,
    difference: comparison.difference,
  });

  return { repaired: true, comparison, stored: comparison.stored, computed: comparison.computed, difference: comparison.difference };
}

export async function repairOrderBalanceCacheIfNeeded(
  row: OrderBalanceRow,
  client: OrderBalanceClient = db,
  options: OrderBalanceUpdateOptions = {},
): Promise<OrderBalanceRepairResult> {
  // Re-read under the same write protocol; a caller's snapshot may already be stale.
  if (client === db) return runInTransaction(async (tx) => {
    await lockOrderBalances(tx, [row.id]);
    return repairOrderBalanceCacheIfNeeded(row, tx, options);
  });
  const result = await updateOrderBalance(row.id, client, options);
  if (result.repaired) await writeBalanceRepairAudit(row, result.comparison, options, client);
  return result;
}

export async function assertReceiptRemovalDoesNotStrandTransfer(
  tx: DbTransactionClient, orderId: string | null, amount: MoneyInput, status: string,
) {
  if (!orderId || status === 'SIGNING_PENDING') return;
  const outgoing = await tx.balanceTransfer.count({ where: { fromOrderId: orderId } });
  if (outgoing && (await calculateLiveOrderBalance(orderId, tx)) + Number(amount) > 0.005) {
    throw createApiError({ code: 'CONFLICT', status: 409, message: '该收款已用于余额转移，请先撤销关联转移再修改或删除收据' });
  }
}
