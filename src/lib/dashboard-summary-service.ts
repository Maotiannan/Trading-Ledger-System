import { DetailEditRequestStatus, DetailStatus, DeletionStatus, ReceiptEditRequestStatus, SwiftEditRequestStatus } from '@prisma/client';
import { db } from '@/lib/db';
import {
  buildDashboardOutstandingSnapshot,
  dashboardOutstandingInvoiceSelect,
  type DashboardCustomerOutstanding,
  type DashboardReleasedInvoice,
} from '@/lib/dashboard-customer-outstanding';
import { compareStoredOrderBalance } from '@/lib/order-balance';
import { repairOrderBalanceCacheIfNeeded } from '@/lib/order-balance-service';
import { logger } from '@/lib/logger';
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
  releasedInvoices: DashboardReleasedInvoice[];
  customerOutstanding: DashboardCustomerOutstanding[];
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
      select: dashboardOutstandingInvoiceSelect(orderWhere),
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

  const outstandingSnapshot = buildDashboardOutstandingSnapshot(visibleInvoices);
  const balanceRepairTasks: Array<Promise<unknown>> = [];

  for (const invoice of visibleInvoices) {
    for (const order of invoice.orders) {
      const computed = outstandingSnapshot.orderBalances.get(order.id) ?? 0;
      const comparison = compareStoredOrderBalance({ stored: order.orderBalance, computed });
      if (!comparison.matches) {
        balanceRepairTasks.push(
          repairOrderBalanceCacheIfNeeded(order, db, {
            actorId: currentUser.id,
            source: 'dashboard-summary',
          }).catch((error) => {
            logger.error('Dashboard order balance cache repair failed', {
              orderId: order.id,
              orderNo: order.orderNo,
              stored: comparison.stored,
              computed: comparison.computed,
              difference: comparison.difference,
              error,
            });
          }),
        );
      }
    }
  }

  if (balanceRepairTasks.length > 0) {
    await Promise.allSettled(balanceRepairTasks);
  }

  return {
    invoiceCount,
    unpaidTotal: outstandingSnapshot.unpaidTotal,
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
    releasedInvoices: outstandingSnapshot.releasedInvoices,
    customerOutstanding: outstandingSnapshot.customerOutstanding,
  };
}
