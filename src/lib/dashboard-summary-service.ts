import { DetailEditRequestStatus, DetailStatus, DeletionStatus, ReceiptEditRequestStatus, SwiftEditRequestStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { formatOrderNameDisplay } from '@/lib/display-format';
import { addMoney, moneyToNumber } from '@/lib/money';
import type { CurrentUser } from '@/lib/request-auth';
import {
  buildDetailVisibilityWhere,
  buildInvoiceVisibilityWhere,
  buildOrderVisibilityWhere,
  buildReceiptVisibilityWhere,
  getOwnerVisibleIds,
} from '@/lib/resource-visibility';

export type DashboardSummary = {
  invoiceCount: number;
  unpaidTotal: number;
  pendingReceipts: number;
  pendingReceiptsAmount: number;
  waitingSwift: number;
  pendingDeletion: number;
  recentReceipts: Array<{
    id: string;
    orderNo: string | null;
    receiptNo: string | null;
    usd: number;
    status: string;
  }>;
  recentDetails: Array<{
    id: string;
    itemCount: number;
    totalAmount: number;
    status: string;
  }>;
  releasedInvoices: Array<{
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
  }>;
  customerOutstanding: Array<{
    customerKey: string;
    customerLabel: string;
    totalOutstanding: number;
    statusSubtotals: {
      inTransit: number;
      released: number;
    };
    orders: Array<{
      orderId: string;
      orderNo: string;
      invNo: string;
      outstanding: number;
      statusGroup: 'IN_TRANSIT' | 'RELEASED';
      releaseDate: string | null;
      daysSinceRelease: number | null;
    }>;
  }>;
};

export async function getDashboardSummary(currentUser: CurrentUser): Promise<DashboardSummary> {
  const ownerIds = await getOwnerVisibleIds(currentUser);
  const invoiceWhere = {
    ...buildInvoiceVisibilityWhere(ownerIds),
    invNo: {
      notIn: ['Un_Associated', 'DEPOSIT_POOL'],
    },
  };
  const receiptWhere = buildReceiptVisibilityWhere(ownerIds);
  const detailWhere = buildDetailVisibilityWhere(ownerIds);
  const orderWhere = buildOrderVisibilityWhere(ownerIds);

  const [
    invoiceCount,
    visibleInvoices,
    pendingReceipts,
    pendingReceiptsAmountAgg,
    waitingSwift,
    recentReceipts,
    recentDetails,
    pendingDeletionRequests,
    pendingReceiptEditRequests,
    pendingDetailEditRequests,
    pendingSwiftEditRequests,
  ] = await Promise.all([
    db.invoice.count({ where: invoiceWhere }),
    db.invoice.findMany({
      where: invoiceWhere,
      select: {
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
          },
        },
      },
    }),
    db.receipt.count({
      where: {
        ...receiptWhere,
        status: 'SR_Received',
      },
    }),
    db.receipt.aggregate({
      where: {
        ...receiptWhere,
        status: 'SR_Received',
      },
      _sum: { usd: true },
    }),
    db.detail.count({
      where: {
        ...detailWhere,
        status: DetailStatus.Waiting_SWIFT,
      },
    }),
    db.receipt.findMany({
      where: receiptWhere,
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orderNo: true,
        receiptNo: true,
        usd: true,
        status: true,
      },
    }),
    db.detail.findMany({
      where: detailWhere,
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        totalAmount: true,
        status: true,
        _count: { select: { items: true } },
      },
    }),
    db.deletionRequest.count({ where: { status: DeletionStatus.PENDING } }),
    db.receiptEditRequest.count({ where: { status: ReceiptEditRequestStatus.PENDING } }),
    db.detailEditRequest.count({ where: { status: DetailEditRequestStatus.PENDING } }),
    db.swiftEditRequest.count({ where: { status: SwiftEditRequestStatus.PENDING } }),
  ]);

  const unpaidTotal = moneyToNumber(addMoney(
    visibleInvoices.flatMap((invoice) => invoice.orders.map((order) => {
      const outstanding = moneyToNumber(order.orderBalance);
      return outstanding > 0 ? outstanding : 0;
    }))
  ));
  const now = Date.now();
  const releasedInvoices: DashboardSummary['releasedInvoices'] = [];
  const customerOutstandingMap = new Map<string, DashboardSummary['customerOutstanding'][number]>();

  for (const invoice of visibleInvoices) {
    let invoiceOutstanding = 0;

    for (const order of invoice.orders) {
      const outstanding = Math.max(moneyToNumber(order.orderBalance), 0);
      invoiceOutstanding += outstanding;

      if (outstanding <= 0) continue;
      const customerLabel = formatOrderNameDisplay(order.customerName || order.customerMark || order.orderNo);
      const customerKey = order.customerId ? `customer:${order.customerId}` : `order:${order.id}`;
      const existing = customerOutstandingMap.get(customerKey);
      const daysSinceRelease = invoice.releaseDate
        ? Math.max(0, Math.floor((now - invoice.releaseDate.getTime()) / 86_400_000))
        : null;
      const statusGroup = invoice.releaseDate ? 'RELEASED' : 'IN_TRANSIT';
      const entry = existing || {
        customerKey,
        customerLabel,
        totalOutstanding: 0,
        statusSubtotals: {
          inTransit: 0,
          released: 0,
        },
        orders: [],
      };
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
      const daysSinceRelease = Math.max(0, Math.floor((now - invoice.releaseDate.getTime()) / 86_400_000));
      releasedInvoices.push({
        id: invoice.id,
        invNo: invoice.invNo,
        releaseDate: invoice.releaseDate.toISOString(),
        daysSinceRelease,
        outstanding: invoiceOutstanding,
        orders: invoice.orders
          .map((order) => ({
            orderId: order.id,
            orderNo: formatOrderNameDisplay(order.orderNo),
            amount: Number(moneyToNumber(order.amount).toFixed(2)),
            outstanding: Number(Math.max(moneyToNumber(order.orderBalance), 0).toFixed(2)),
          }))
          .sort((a, b) => b.outstanding - a.outstanding || a.orderNo.localeCompare(b.orderNo)),
      });
    }
  }

  releasedInvoices.sort((a, b) => (
    b.daysSinceRelease - a.daysSinceRelease
    || a.releaseDate.localeCompare(b.releaseDate)
    || a.invNo.localeCompare(b.invNo)
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
        .sort((a, b) => {
          if (a.statusGroup !== b.statusGroup) return a.statusGroup === 'IN_TRANSIT' ? -1 : 1;
          return b.outstanding - a.outstanding || a.orderNo.localeCompare(b.orderNo);
        }),
    }))
    .sort((a, b) => b.totalOutstanding - a.totalOutstanding || a.customerLabel.localeCompare(b.customerLabel));

  return {
    invoiceCount,
    unpaidTotal,
    pendingReceipts,
    pendingReceiptsAmount: Number(pendingReceiptsAmountAgg._sum.usd ?? 0),
    waitingSwift,
    pendingDeletion: pendingDeletionRequests
      + pendingReceiptEditRequests
      + pendingDetailEditRequests
      + pendingSwiftEditRequests,
    recentReceipts: recentReceipts.map((receipt) => ({
      id: receipt.id,
      orderNo: receipt.orderNo,
      receiptNo: receipt.receiptNo,
      usd: Number(receipt.usd),
      status: receipt.status,
    })),
    recentDetails: recentDetails.map((detail) => ({
      id: detail.id,
      itemCount: detail._count.items,
      totalAmount: Number(detail.totalAmount),
      status: detail.status,
    })),
    releasedInvoices: releasedInvoices.map((invoice) => ({
      ...invoice,
      outstanding: Number(invoice.outstanding.toFixed(2)),
    })),
    customerOutstanding,
  };
}
