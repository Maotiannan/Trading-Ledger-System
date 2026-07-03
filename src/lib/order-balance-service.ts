import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { recordAuditEvent } from '@/lib/audit';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { DbTransactionClient } from '@/lib/transaction';
import {
  compareStoredOrderBalance,
  computeOrderBalanceFromReceipts,
  type OrderBalanceComparison,
  type OrderBalanceReceiptInput,
} from '@/lib/order-balance';
import type { MoneyInput } from '@/lib/money';

export type OrderBalanceClient = Pick<DbTransactionClient, 'order'>;

export type OrderBalanceRow = {
  id: string;
  orderNo?: string | null;
  amount: MoneyInput;
  orderBalance?: MoneyInput;
  receipts?: OrderBalanceReceiptInput[] | null;
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
      receipts: {
        select: {
          usd: true,
          status: true,
        },
      },
    },
  }) as Promise<OrderBalanceRow | null>;
}

function computeComparison(row: OrderBalanceRow): OrderBalanceComparison {
  const computed = computeOrderBalanceFromReceipts({
    amount: row.amount,
    receipts: row.receipts || [],
  });

  return compareStoredOrderBalance({
    stored: row.orderBalance || 0,
    computed,
  });
}

async function writeBalanceRepairAudit(row: OrderBalanceRow, comparison: OrderBalanceComparison, options: OrderBalanceUpdateOptions) {
  if (!options.actorId) return;

  try {
    await recordAuditEvent({
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
    });
  } catch (error) {
    logger.error('Order balance cache repair audit failed', {
      orderId: row.id,
      orderNo: row.orderNo || null,
      source: options.source || DEFAULT_BALANCE_SOURCE,
      error,
    });
  }
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
  const comparison = computeComparison(row);
  if (comparison.matches) {
    return { repaired: false, comparison, stored: comparison.stored, computed: comparison.computed, difference: comparison.difference };
  }

  await client.order.update({
    where: { id: row.id },
    data: { orderBalance: comparison.computed },
  });

  logger.warn('Order balance cache mismatch repaired', {
    orderId: row.id,
    orderNo: row.orderNo || null,
    stored: comparison.stored,
    computed: comparison.computed,
    difference: comparison.difference,
    source: options.source || DEFAULT_BALANCE_SOURCE,
  });

  await writeBalanceRepairAudit(row, comparison, options);

  return { repaired: true, comparison, stored: comparison.stored, computed: comparison.computed, difference: comparison.difference };
}
