import { DetailStatus, DeletionStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { listDeletionRequests } from '@/lib/deletion-service';
import { formatOrderNameDisplay } from '@/lib/display-format';
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
  }>;
  customerOutstanding: Array<{
    customerKey: string;
    customerLabel: string;
    totalOutstanding: number;
    orders: Array<{
      orderId: string;
      orderNo: string;
      invNo: string;
      outstanding: number;
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

  const [invoiceCount, visibleInvoices, pendingReceipts, waitingSwift, recentReceipts, recentDetails, deletionRequests] = await Promise.all([
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
            customerName: true,
            customerMark: true,
            amount: true,
            receipts: {
              where: {
                orderId: { not: null },
                ...receiptWhere,
              },
              select: {
                usd: true,
              },
            },
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
    listDeletionRequests(currentUser),
  ]);

  const unpaidTotal = visibleInvoices.reduce((invoiceSum, invoice) => {
    const invAmount = invoice.orders.reduce((orderSum, order) => orderSum + Number(order.amount), 0);
    const receivedAmount = invoice.orders.reduce((orderSum, order) => (
      orderSum + order.receipts.reduce((receiptSum, receipt) => receiptSum + Number(receipt.usd), 0)
    ), 0);
    const invBalance = invAmount - receivedAmount;

    return invoiceSum + Math.max(invBalance, 0);
  }, 0);
  const now = Date.now();
  const releasedInvoices: DashboardSummary['releasedInvoices'] = [];
  const customerOutstandingMap = new Map<string, DashboardSummary['customerOutstanding'][number]>();

  for (const invoice of visibleInvoices) {
    let invoiceOutstanding = 0;

    for (const order of invoice.orders) {
      const receivedAmount = order.receipts.reduce((receiptSum, receipt) => receiptSum + Number(receipt.usd), 0);
      const outstanding = Math.max(Number(order.amount) - receivedAmount, 0);
      invoiceOutstanding += outstanding;

      if (outstanding <= 0) continue;
      const customerLabel = formatOrderNameDisplay(order.customerName || order.customerMark || order.orderNo);
      const customerKey = customerLabel;
      const existing = customerOutstandingMap.get(customerKey);
      const entry = existing || {
        customerKey,
        customerLabel,
        totalOutstanding: 0,
        orders: [],
      };
      entry.totalOutstanding += outstanding;
      entry.orders.push({
        orderId: order.id,
        orderNo: formatOrderNameDisplay(order.orderNo),
        invNo: invoice.invNo,
        outstanding,
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
      orders: entry.orders
        .map((order) => ({ ...order, outstanding: Number(order.outstanding.toFixed(2)) }))
        .sort((a, b) => b.outstanding - a.outstanding || a.orderNo.localeCompare(b.orderNo)),
    }))
    .sort((a, b) => b.totalOutstanding - a.totalOutstanding || a.customerLabel.localeCompare(b.customerLabel));

  return {
    invoiceCount,
    unpaidTotal,
    pendingReceipts,
    waitingSwift,
    pendingDeletion: deletionRequests.filter((request) => request.status === DeletionStatus.PENDING).length,
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
