import type { Prisma } from '@prisma/client';
import { formatOrderNameDisplay } from '@/lib/display-format';
import { addMoney, moneyToNumber, type MoneyInput } from '@/lib/money';
import { computeOrderBalanceFromReceipts, type OrderBalanceReceiptInput } from '@/lib/order-balance';

export type DashboardOutstandingOrderInput = {
  id: string;
  orderNo: string;
  customerId: string | null;
  customerName: string | null;
  customerMark: string | null;
  amount: MoneyInput;
  orderBalance: MoneyInput;
  receipts: OrderBalanceReceiptInput[];
};

export type DashboardOutstandingInvoiceInput = {
  id: string;
  invNo: string;
  releaseDate: Date | null;
  orders: DashboardOutstandingOrderInput[];
};

export type DashboardReleasedInvoice = {
  id: string;
  invNo: string;
  releaseDate: string;
  daysSinceRelease: number;
  outstanding: number;
  orders: Array<{
    orderId: string;
    orderNo: string;
    amount: number;
    outstanding: number;
  }>;
};

export type DashboardCustomerOutstandingOrder = {
  orderId: string;
  orderNo: string;
  invNo: string;
  outstanding: number;
  statusGroup: 'IN_TRANSIT' | 'RELEASED';
  releaseDate: string | null;
  daysSinceRelease: number | null;
};

export type DashboardCustomerOutstanding = {
  customerId: string | null;
  customerKey: string;
  customerLabel: string;
  totalOutstanding: number;
  statusSubtotals: {
    inTransit: number;
    released: number;
  };
  orders: DashboardCustomerOutstandingOrder[];
};

export type DashboardOutstandingSnapshot = {
  orderBalances: Map<string, number>;
  unpaidTotal: number;
  releasedInvoices: DashboardReleasedInvoice[];
  customerOutstanding: DashboardCustomerOutstanding[];
};

export function dashboardOutstandingInvoiceSelect(orderWhere: Prisma.OrderWhereInput) {
  return {
    id: true,
    invNo: true,
    releaseDate: true,
    orders: {
      where: orderWhere,
      select: {
        id: true,
        orderNo: true,
        customerId: true,
        customerName: true,
        customerMark: true,
        amount: true,
        orderBalance: true,
        receipts: {
          select: {
            usd: true,
            status: true,
          },
        },
      },
    },
  } as const;
}

export function buildDashboardOutstandingSnapshot(
  invoices: DashboardOutstandingInvoiceInput[],
  nowMs = Date.now(),
): DashboardOutstandingSnapshot {
  const orderBalances = new Map<string, number>();
  for (const invoice of invoices) {
    for (const order of invoice.orders) {
      orderBalances.set(order.id, computeOrderBalanceFromReceipts({
        amount: order.amount,
        receipts: order.receipts,
      }));
    }
  }

  const balanceFor = (orderId: string) => orderBalances.get(orderId) ?? 0;
  const unpaidTotal = moneyToNumber(addMoney(
    invoices.flatMap((invoice) => invoice.orders.map((order) => Math.max(balanceFor(order.id), 0))),
  ));
  const releasedInvoices: DashboardReleasedInvoice[] = [];
  const customerOutstandingMap = new Map<string, DashboardCustomerOutstanding>();

  for (const invoice of invoices) {
    let invoiceOutstanding = 0;

    for (const order of invoice.orders) {
      const outstanding = Math.max(balanceFor(order.id), 0);
      invoiceOutstanding += outstanding;
      if (outstanding <= 0) continue;

      const customerLabel = formatOrderNameDisplay(order.customerName || order.customerMark || order.orderNo);
      const customerKey = order.customerId ? `customer:${order.customerId}` : `order:${order.id}`;
      const daysSinceRelease = invoice.releaseDate
        ? Math.max(0, Math.floor((nowMs - invoice.releaseDate.getTime()) / 86_400_000))
        : null;
      const statusGroup = invoice.releaseDate ? 'RELEASED' : 'IN_TRANSIT';
      const entry = customerOutstandingMap.get(customerKey) || {
        customerId: order.customerId,
        customerKey,
        customerLabel,
        totalOutstanding: 0,
        statusSubtotals: { inTransit: 0, released: 0 },
        orders: [],
      } satisfies DashboardCustomerOutstanding;

      entry.totalOutstanding += outstanding;
      if (statusGroup === 'RELEASED') {
        entry.statusSubtotals.released += outstanding;
      } else {
        entry.statusSubtotals.inTransit += outstanding;
      }
      entry.orders.push({
        orderId: order.id,
        orderNo: formatOrderNameDisplay(order.orderNo),
        invNo: invoice.invNo,
        outstanding,
        statusGroup,
        releaseDate: invoice.releaseDate ? invoice.releaseDate.toISOString() : null,
        daysSinceRelease,
      });
      customerOutstandingMap.set(customerKey, entry);
    }

    if (invoice.releaseDate && invoiceOutstanding > 0) {
      const daysSinceRelease = Math.max(0, Math.floor((nowMs - invoice.releaseDate.getTime()) / 86_400_000));
      releasedInvoices.push({
        id: invoice.id,
        invNo: invoice.invNo,
        releaseDate: invoice.releaseDate.toISOString(),
        daysSinceRelease,
        outstanding: Number(invoiceOutstanding.toFixed(2)),
        orders: invoice.orders
          .map((order) => ({
            orderId: order.id,
            orderNo: formatOrderNameDisplay(order.orderNo),
            amount: Number(moneyToNumber(order.amount).toFixed(2)),
            outstanding: Number(Math.max(balanceFor(order.id), 0).toFixed(2)),
          }))
          .sort((left, right) => right.outstanding - left.outstanding || left.orderNo.localeCompare(right.orderNo)),
      });
    }
  }

  releasedInvoices.sort((left, right) => (
    right.daysSinceRelease - left.daysSinceRelease
    || left.releaseDate.localeCompare(right.releaseDate)
    || left.invNo.localeCompare(right.invNo)
  ));

  const customerOutstanding = Array.from(customerOutstandingMap.values())
    .map((entry) => ({
      ...entry,
      totalOutstanding: Number(entry.totalOutstanding.toFixed(2)),
      statusSubtotals: {
        inTransit: Number(entry.statusSubtotals.inTransit.toFixed(2)),
        released: Number(entry.statusSubtotals.released.toFixed(2)),
      },
      orders: entry.orders
        .map((order) => ({ ...order, outstanding: Number(order.outstanding.toFixed(2)) }))
        .sort((left, right) => {
          if (left.statusGroup !== right.statusGroup) return left.statusGroup === 'IN_TRANSIT' ? -1 : 1;
          return right.outstanding - left.outstanding || left.orderNo.localeCompare(right.orderNo);
        }),
    }))
    .sort((left, right) => (
      right.totalOutstanding - left.totalOutstanding
      || left.customerLabel.localeCompare(right.customerLabel)
    ));

  return {
    orderBalances,
    unpaidTotal,
    releasedInvoices,
    customerOutstanding,
  };
}
