import { db } from '@/lib/db';
import { resolveCustomer } from '@/lib/customer-matching';
import { serializeOrderTokens } from '@/lib/tokenizer';
import { updateOrderBalance } from '@/lib/matching';
import { buildOrderNoWithAliases, normalizeOrderNo } from '@/lib/order-alias';
import { consolidateGroupedOrders, findOrderIdByNoOrAlias, syncOrderAliases } from '@/lib/order-alias-db';

export type InvoiceOrderInput = {
  orderNo: string;
  amount: number;
  customerMark: string;
  customerName?: string | null;
  customerId?: string | null;
};

export async function saveInvoiceWithOrders(input: {
  invNo: string;
  orders: InvoiceOrderInput[];
  createdBy: string;
  shipDate?: Date | null;
  releaseDate?: Date | null;
}) {
  const normalizedInvNo = String(input.invNo || '').trim();
  if (!normalizedInvNo) {
    return { ok: false as const, status: 400, error: '账单号不能为空' };
  }
  if (!Array.isArray(input.orders) || input.orders.length === 0) {
    return { ok: false as const, status: 400, error: '订单列表不能为空' };
  }

  const normalizeOrderNoLocal = (value: string) => normalizeOrderNo(value);

  let targetInvoice = await db.invoice.findFirst({
    where: { invNo: normalizedInvNo },
    select: { id: true, invNo: true },
  });
  if (!targetInvoice) {
    targetInvoice = await db.invoice.create({
      data: {
        invNo: normalizedInvNo,
        createdBy: input.createdBy,
        shipDate: input.shipDate ?? null,
        releaseDate: input.releaseDate ?? null,
      },
      select: { id: true, invNo: true },
    });
  } else if (input.shipDate !== undefined || input.releaseDate !== undefined) {
    await db.invoice.update({
      where: { id: targetInvoice.id },
      data: {
        ...(input.shipDate !== undefined ? { shipDate: input.shipDate } : {}),
        ...(input.releaseDate !== undefined ? { releaseDate: input.releaseDate } : {}),
      },
    });
  }

  const mergedOrdersInfo: string[] = [];
  const touchedOrderIds = new Set<string>();
  let hasNeedsCustomerFix = false;

  for (const rawOrder of input.orders) {
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
    });
    if (customerResolution.needsCustomerFix) hasNeedsCustomerFix = true;

    const existingInTargetId = await findOrderIdByNoOrAlias(canonicalOrderNo, { invoiceId: targetInvoice.id });
    const existingInTarget = existingInTargetId
      ? await db.order.findUnique({ where: { id: existingInTargetId }, select: { id: true, orderNo: true } })
      : null;

    if (existingInTarget) {
      await db.order.update({
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
      await syncOrderAliases(db, existingInTarget.id, canonicalOrderNo);
      touchedOrderIds.add(existingInTarget.id);
      continue;
    }

    const existingGlobalId = await findOrderIdByNoOrAlias(canonicalOrderNo);
    const existingGlobalOrder = existingGlobalId
      ? await db.order.findUnique({
          where: { id: existingGlobalId },
          include: { invoice: true },
        })
      : null;
    const existingSystemOrder = existingGlobalOrder?.invoice.invNo === 'Un_Associated' ? existingGlobalOrder : null;

    if (existingSystemOrder) {
      const newOrder = await db.order.create({
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

      await db.receipt.updateMany({
        where: { orderId: existingSystemOrder.id },
        data: { orderId: newOrder.id },
      });
      await db.order.delete({ where: { id: existingSystemOrder.id } });
      await syncOrderAliases(db, newOrder.id, canonicalOrderNo);
      await updateOrderBalance(newOrder.id);

      touchedOrderIds.add(newOrder.id);
      mergedOrdersInfo.push(`${canonicalOrderNo} (from Un_Associated)`);
      continue;
    }

    const existingOrder = existingGlobalOrder;

    if (existingOrder) {
      await db.order.update({
        where: { id: existingOrder.id },
        data: {
          ...(normalizeOrderNo(existingOrder.orderNo) !== normalizeOrderNo(canonicalOrderNo)
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
      await syncOrderAliases(db, existingOrder.id, canonicalOrderNo);
      touchedOrderIds.add(existingOrder.id);
      mergedOrdersInfo.push(`${canonicalOrderNo} (merged into invoice ${existingOrder.invoice.invNo})`);
      continue;
    }

    const created = await db.order.create({
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
    await syncOrderAliases(db, created.id, canonicalOrderNo);
    touchedOrderIds.add(created.id);
  }

  await consolidateGroupedOrders({ invoiceIds: [targetInvoice.id] });

  for (const orderId of touchedOrderIds) {
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
    const deposits = allDeposits.filter((d) =>
      d.orderNo ? normalizeOrderNoLocal(d.orderNo).includes(normalizedOrderNo) : false
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

  const invoice = await db.invoice.findUnique({
    where: { id: targetInvoice.id },
    include: { orders: true },
  });

  const messageParts: string[] = [];
  if (mergedOrdersInfo.length > 0) {
    messageParts.push(`部分订单已合并: ${mergedOrdersInfo.join(', ')}`);
  }
  if (hasNeedsCustomerFix) {
    messageParts.push('please modify guest information');
  }
  const message = messageParts.length > 0 ? `账单已保存，${messageParts.join('；')}` : '账单已保存';

  return { ok: true as const, data: invoice, message };
}
