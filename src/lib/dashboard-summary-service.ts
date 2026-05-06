import { DetailStatus, DeletionStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { listDeletionRequests } from '@/lib/deletion-service';
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
        orders: {
          where: orderWhere,
          select: {
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
  };
}
