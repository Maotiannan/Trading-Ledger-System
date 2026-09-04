import { db } from '@/lib/db';
import { resolveCustomer } from '@/lib/customer-matching';
import {
  migrateSystemPoolOrderForInvoiceRow,
  type SystemPoolMigrationAudit,
  type SystemPoolOperationSource,
} from '@/lib/invoice-system-pool-reconciliation';
import { updateOrderBalance } from '@/lib/matching';
import { buildOrderNoWithAliases, normalizeOrderNo } from '@/lib/order-alias';
import {
  consolidateGroupedOrders,
  findOrderIdByNoOrAliasWithExecutor,
  syncOrderAliases,
} from '@/lib/order-alias-db';
import { serializeOrderTokens } from '@/lib/tokenizer';
import { runInTransaction, type DbTransactionClient } from '@/lib/transaction';
import {
  projectInvoiceEventsInTransaction,
  refreshOrderLinkedNotificationsInTransaction,
} from '@/lib/email/email-notification-projector';

export type InvoiceOrderInput = {
  orderNo: string;
  amount: number;
  customerMark: string;
  customerName?: string | null;
  customerId?: string | null;
};

type PreparedInvoiceOrderInput = {
  canonicalOrderNo: string;
  amountNumber: number;
  customerResolution: Awaited<ReturnType<typeof resolveCustomer>>;
};

function normalizeOrderNoLocal(value: string) {
  return normalizeOrderNo(value);
}

async function prepareInvoiceOrders(orders: InvoiceOrderInput[], ownerIds?: string[]) {
  const preparedOrders: PreparedInvoiceOrderInput[] = [];
  let hasNeedsCustomerFix = false;

  for (const rawOrder of orders) {
    const rawOrderNo = typeof rawOrder.orderNo === 'string' ? rawOrder.orderNo.trim() : '';
    const { canonicalOrderNo } = buildOrderNoWithAliases(rawOrderNo);
    const amountNumber = Number(rawOrder.amount);
    const rowCustomerMark = typeof rawOrder.customerMark === 'string' ? rawOrder.customerMark.trim() : '';
    const rowCustomerName = typeof rawOrder.customerName === 'string' ? rawOrder.customerName.trim() : '';
    const rowCustomerId = typeof rawOrder.customerId === 'string' ? rawOrder.customerId.trim() : '';

    if (!canonicalOrderNo || !Number.isFinite(amountNumber) || amountNumber <= 0 || !rowCustomerMark) {
      return {
        ok: false as const,
        status: 400,
        error: '每一行订单都必须填写 ORDER、AMOUNT(>0)、MARK',
      };
    }

    const customerResolution = await resolveCustomer({
      customerMark: rowCustomerMark,
      customerName: rowCustomerName || null,
      customerId: rowCustomerId || null,
      customerOrderNo: canonicalOrderNo,
      ownerIds,
    });
    if (customerResolution.needsCustomerFix) hasNeedsCustomerFix = true;

    preparedOrders.push({
      canonicalOrderNo,
      amountNumber,
      customerResolution,
    });
  }

  return {
    ok: true as const,
    preparedOrders,
    hasNeedsCustomerFix,
  };
}

async function persistInvoiceWithOrders(
  tx: DbTransactionClient,
  input: {
    normalizedInvNo: string;
    preparedOrders: PreparedInvoiceOrderInput[];
    createdBy: string;
    operationSource: SystemPoolOperationSource;
    shipDate?: Date | null;
    releaseDate?: Date | null;
  }
) {
  let targetInvoice = await tx.invoice.findFirst({
    where: { invNo: input.normalizedInvNo },
    select: { id: true, invNo: true, shipDate: true, releaseDate: true },
  });
  const beforeShipDate = targetInvoice?.shipDate ?? null;
  const beforeReleaseDate = targetInvoice?.releaseDate ?? null;

  if (!targetInvoice) {
    targetInvoice = await tx.invoice.create({
      data: {
        invNo: input.normalizedInvNo,
        createdBy: input.createdBy,
        shipDate: input.shipDate ?? null,
        releaseDate: input.releaseDate ?? null,
      },
      select: { id: true, invNo: true, shipDate: true, releaseDate: true },
    });
  } else if (input.shipDate !== undefined || input.releaseDate !== undefined) {
    await tx.invoice.update({
      where: { id: targetInvoice.id },
      data: {
        ...(input.shipDate !== undefined ? { shipDate: input.shipDate } : {}),
        ...(input.releaseDate !== undefined ? { releaseDate: input.releaseDate } : {}),
      },
    });
  }

  const mergedOrdersInfo: string[] = [];
  const touchedOrderIds = new Set<string>();
  const poolMigrations: SystemPoolMigrationAudit[] = [];

  for (const preparedOrder of input.preparedOrders) {
    const { canonicalOrderNo, amountNumber, customerResolution } = preparedOrder;

    const existingInTargetId = await findOrderIdByNoOrAliasWithExecutor(
      tx,
      canonicalOrderNo,
      { invoiceId: targetInvoice.id }
    );
    const existingInTarget = existingInTargetId
      ? await tx.order.findUnique({
          where: { id: existingInTargetId },
          select: { id: true, orderNo: true },
        })
      : null;

    if (existingInTarget) {
      await tx.order.update({
        where: { id: existingInTarget.id },
        data: {
          ...(normalizeOrderNo(existingInTarget.orderNo) !== normalizeOrderNo(canonicalOrderNo)
            ? {
                orderNo: canonicalOrderNo,
                tokens: serializeOrderTokens(canonicalOrderNo),
              }
            : {}),
          amount: { increment: amountNumber },
          orderBalance: { increment: amountNumber },
          customerId: customerResolution.customerId,
          customerMark: customerResolution.customerMark,
          customerName: customerResolution.customerName,
          customerPhone: customerResolution.customerPhone,
          customerCity: customerResolution.customerCity,
          needsCustomerFix: customerResolution.needsCustomerFix,
        },
      });
      await syncOrderAliases(tx, existingInTarget.id, canonicalOrderNo);
    }

    const migrated = await migrateSystemPoolOrderForInvoiceRow(tx, {
      orderNo: canonicalOrderNo,
      targetInvoice,
      authoritativeAmount: amountNumber,
      targetOrderId: existingInTarget?.id ?? null,
      customer: customerResolution,
      operationSource: input.operationSource,
    });
    if (migrated) {
      touchedOrderIds.add(migrated.targetOrderId);
      poolMigrations.push(migrated.audit);
      mergedOrdersInfo.push(`${canonicalOrderNo} (from ${migrated.audit.sourcePool})`);
      continue;
    }

    if (existingInTarget) {
      touchedOrderIds.add(existingInTarget.id);
      continue;
    }

    const existingGlobalId = await findOrderIdByNoOrAliasWithExecutor(tx, canonicalOrderNo);
    const existingGlobalOrder = existingGlobalId
      ? await tx.order.findUnique({
          where: { id: existingGlobalId },
          include: { invoice: true },
        })
      : null;
    if (existingGlobalOrder) {
      await tx.order.update({
        where: { id: existingGlobalOrder.id },
        data: {
          ...(normalizeOrderNo(existingGlobalOrder.orderNo) !== normalizeOrderNo(canonicalOrderNo)
            ? {
                orderNo: canonicalOrderNo,
                tokens: serializeOrderTokens(canonicalOrderNo),
              }
            : {}),
          amount: { increment: amountNumber },
          orderBalance: { increment: amountNumber },
          customerId: customerResolution.customerId,
          customerMark: customerResolution.customerMark,
          customerName: customerResolution.customerName,
          customerPhone: customerResolution.customerPhone,
          customerCity: customerResolution.customerCity,
          needsCustomerFix: customerResolution.needsCustomerFix,
        },
      });
      await syncOrderAliases(tx, existingGlobalOrder.id, canonicalOrderNo);
      touchedOrderIds.add(existingGlobalOrder.id);
      mergedOrdersInfo.push(`${canonicalOrderNo} (merged into invoice ${existingGlobalOrder.invoice.invNo})`);
      continue;
    }

    const created = await tx.order.create({
      data: {
        invoiceId: targetInvoice.id,
        orderNo: canonicalOrderNo,
        tokens: serializeOrderTokens(canonicalOrderNo),
        amount: amountNumber,
        orderBalance: amountNumber,
        createdBy: input.createdBy,
        customerId: customerResolution.customerId,
        customerMark: customerResolution.customerMark,
        customerName: customerResolution.customerName,
        customerPhone: customerResolution.customerPhone,
        customerCity: customerResolution.customerCity,
        needsCustomerFix: customerResolution.needsCustomerFix,
      },
      select: { id: true, orderNo: true },
    });
    await syncOrderAliases(tx, created.id, canonicalOrderNo);
    touchedOrderIds.add(created.id);
  }

  await refreshOrderLinkedNotificationsInTransaction(tx, {
    orderIds: Array.from(touchedOrderIds),
    invoiceIds: [targetInvoice.id],
    actorId: input.createdBy,
  });
  await projectInvoiceEventsInTransaction(tx, {
    invoiceId: targetInvoice.id,
    beforeShipDate,
    beforeReleaseDate,
    actorId: input.createdBy,
  });

  return {
    targetInvoiceId: targetInvoice.id,
    touchedOrderIds: Array.from(touchedOrderIds),
    mergedOrdersInfo,
    poolMigrations,
  };
}

async function reconcileTouchedOrders(orderIds: string[]): Promise<void> {
  for (const orderId of orderIds) {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNo: true },
    });
    if (!order) continue;

    const allDeposits = await db.receipt.findMany({
      where: {
        isDeposit: true,
        isMerged: false,
      },
    });

    const normalizedOrderNo = normalizeOrderNoLocal(order.orderNo);
    const deposits = allDeposits.filter((deposit) =>
      deposit.orderNo ? normalizeOrderNoLocal(deposit.orderNo).includes(normalizedOrderNo) : false
    );

    for (const deposit of deposits) {
      await db.receipt.update({
        where: { id: deposit.id },
        data: {
          orderId: order.id,
          isMerged: true,
        },
      });
    }

    await updateOrderBalance(order.id);
  }
}

export async function saveInvoiceWithOrders(input: {
  invNo: string;
  orders: InvoiceOrderInput[];
  createdBy: string;
  operationSource: SystemPoolOperationSource;
  shipDate?: Date | null;
  releaseDate?: Date | null;
  ownerIds?: string[];
}) {
  const normalizedInvNo = String(input.invNo || '').trim();
  if (!normalizedInvNo) {
    return { ok: false as const, status: 400, error: '账单号不能为空' };
  }
  if (!Array.isArray(input.orders) || input.orders.length === 0) {
    return { ok: false as const, status: 400, error: '订单列表不能为空' };
  }

  const prepared = await prepareInvoiceOrders(input.orders, input.ownerIds);
  if (!prepared.ok) {
    return prepared;
  }

  const persisted = await runInTransaction(async (tx) => persistInvoiceWithOrders(tx, {
    normalizedInvNo,
    preparedOrders: prepared.preparedOrders,
    createdBy: input.createdBy,
    operationSource: input.operationSource,
    shipDate: input.shipDate,
    releaseDate: input.releaseDate,
  }));

  await consolidateGroupedOrders({ invoiceIds: [persisted.targetInvoiceId] });
  await reconcileTouchedOrders(persisted.touchedOrderIds);

  const invoice = await db.invoice.findUnique({
    where: { id: persisted.targetInvoiceId },
    include: { orders: true },
  });

  const messageParts: string[] = [];
  if (persisted.mergedOrdersInfo.length > 0) {
    messageParts.push(`部分订单已合并: ${persisted.mergedOrdersInfo.join(', ')}`);
  }
  if (prepared.hasNeedsCustomerFix) {
    messageParts.push('请修复客户信息');
  }

  return {
    ok: true as const,
    data: invoice,
    poolMigrations: persisted.poolMigrations,
    message: messageParts.length > 0 ? `账单已保存，${messageParts.join('；')}` : '账单已保存',
  };
}
