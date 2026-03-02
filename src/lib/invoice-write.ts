import { db } from '@/lib/db';
import { resolveCustomer } from '@/lib/customer-matching';
import { serializeOrderTokens } from '@/lib/tokenizer';
import { updateOrderBalance } from '@/lib/matching';

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
}) {
  const normalizedInvNo = String(input.invNo || '').trim();
  if (!normalizedInvNo) {
    return { ok: false as const, status: 400, error: '账单号不能为空' };
  }
  if (!Array.isArray(input.orders) || input.orders.length === 0) {
    return { ok: false as const, status: 400, error: '订单列表不能为空' };
  }

  const normalizeOrderNo = (value: string) => value.toLowerCase().trim();

  let targetInvoice = await db.invoice.findFirst({
    where: { invNo: normalizedInvNo },
    select: { id: true, invNo: true },
  });
  if (!targetInvoice) {
    targetInvoice = await db.invoice.create({
      data: {
        invNo: normalizedInvNo,
        createdBy: input.createdBy,
      },
      select: { id: true, invNo: true },
    });
  }

  const mergedOrdersInfo: string[] = [];
  const touchedOrderIds = new Set<string>();
  let hasNeedsCustomerFix = false;

  for (const rawOrder of input.orders) {
    const normalizedOrderNoRaw = typeof rawOrder.orderNo === 'string' ? rawOrder.orderNo.trim() : '';
    const amountNumber = Number(rawOrder.amount);
    const rowCustomerMark = typeof rawOrder.customerMark === 'string' ? rawOrder.customerMark.trim() : '';
    const rowCustomerName = typeof rawOrder.customerName === 'string' ? rawOrder.customerName.trim() : '';
    const rowCustomerId = typeof rawOrder.customerId === 'string' ? rawOrder.customerId.trim() : '';
    if (!normalizedOrderNoRaw || !Number.isFinite(amountNumber) || amountNumber <= 0 || !rowCustomerMark) {
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

    const existingInTarget = await db.order.findFirst({
      where: {
        invoiceId: targetInvoice.id,
        orderNo: {
          equals: normalizedOrderNoRaw,
        },
      },
      select: { id: true, orderNo: true },
    });

    if (existingInTarget) {
      await db.order.update({
        where: { id: existingInTarget.id },
        data: {
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
      touchedOrderIds.add(existingInTarget.id);
      continue;
    }

    const existingSystemOrder = await db.order.findFirst({
      where: {
        orderNo: {
          equals: normalizedOrderNoRaw,
        },
        invoice: { invNo: 'Un_Associated' },
      },
      include: { invoice: true },
    });

    if (existingSystemOrder) {
      const newOrder = await db.order.create({
        data: {
          invoiceId: targetInvoice.id,
          orderNo: normalizedOrderNoRaw,
          tokens: serializeOrderTokens(normalizedOrderNoRaw),
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
      await updateOrderBalance(newOrder.id);

      touchedOrderIds.add(newOrder.id);
      mergedOrdersInfo.push(`${normalizedOrderNoRaw} (从 Un_Associated 合并)`);
      continue;
    }

    const existingOrder = await db.order.findFirst({
      where: {
        orderNo: {
          equals: normalizedOrderNoRaw,
        },
      },
      include: { invoice: true },
    });

    if (existingOrder) {
      await db.order.update({
        where: { id: existingOrder.id },
        data: {
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
      touchedOrderIds.add(existingOrder.id);
      mergedOrdersInfo.push(`${normalizedOrderNoRaw} (合并到账单 ${existingOrder.invoice.invNo})`);
      continue;
    }

    const created = await db.order.create({
      data: {
        invoiceId: targetInvoice.id,
        orderNo: normalizedOrderNoRaw,
        tokens: serializeOrderTokens(normalizedOrderNoRaw),
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
    touchedOrderIds.add(created.id);
  }

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

    const normalizedOrderNo = normalizeOrderNo(order.orderNo);
    const deposits = allDeposits.filter((d) =>
      d.orderNo ? normalizeOrderNo(d.orderNo).includes(normalizedOrderNo) : false
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
