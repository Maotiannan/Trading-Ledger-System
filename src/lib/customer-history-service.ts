import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { apiErrorCodes, createApiError } from '@/lib/api-error';
import { computeOrderBalanceFromReceipts } from '@/lib/order-balance';
import {
  normalizeCustomerHistoryPagination,
  paginateCustomerHistoryRows,
  sortCustomerHistoryOrders,
} from '@/lib/customer-order-history-pagination';
import { buildCompositeOrderLookupCandidates, normalizeOrderIdentifier } from '@/lib/order-name-kernel';

function trimStr(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function toDateText(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  return text ? text.slice(0, 10) : null;
}

function orderMatchesOrderName(orderNo: string | null | undefined, normalizedOrderName: string): boolean {
  if (!normalizedOrderName) return false;
  if (normalizeOrderIdentifier(orderNo) === normalizedOrderName) return true;
  return buildCompositeOrderLookupCandidates(orderNo).orderNameCandidates
    .some((candidate) => candidate.normalizedOrderName === normalizedOrderName);
}

function combineWhere<T extends Record<string, unknown>>(base: T, scope?: Record<string, unknown>): T | { AND: Array<T | Record<string, unknown>> } {
  if (!scope || Object.keys(scope).length === 0) return base;
  return { AND: [base, scope] };
}

export type CustomerHistoryReadInput = {
  customerId: string;
  orderName?: string | null;
  orderPage?: unknown;
  orderPageSize?: unknown;
  receiptPage?: unknown;
  receiptPageSize?: unknown;
  defaultOrderPageSize?: number;
  defaultReceiptPageSize?: number;
  customerWhere?: Prisma.CustomerWhereInput;
  orderWhere?: Prisma.OrderWhereInput;
  receiptWhere?: Prisma.ReceiptWhereInput;
};

export async function readCustomerHistory(input: CustomerHistoryReadInput) {
  const customerId = trimStr(input.customerId);
  const orderName = trimStr(input.orderName);
  const normalizedOrderName = normalizeOrderIdentifier(orderName);
  if (!customerId) {
    throw createApiError({ code: apiErrorCodes.BAD_REQUEST, status: 400, message: '缺少客户' });
  }

  const customer = await db.customer.findFirst({
    where: combineWhere({ id: customerId }, input.customerWhere as Record<string, unknown> | undefined),
    select: {
      id: true,
      mark: true,
      orderName: true,
      name: true,
      orderNames: {
        select: {
          orderName: true,
          normalizedOrderName: true,
          isPrimary: true,
        },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
    },
  });
  if (!customer) {
    throw createApiError({ code: apiErrorCodes.RESOURCE_NOT_FOUND, status: 404, message: '客户不存在或无权限' });
  }

  if (normalizedOrderName) {
    const isKnownOrderName = normalizeOrderIdentifier(customer.orderName) === normalizedOrderName
      || customer.orderNames.some((row) => row.normalizedOrderName === normalizedOrderName);
    if (!isKnownOrderName) {
      throw createApiError({ code: apiErrorCodes.BAD_REQUEST, status: 400, message: 'ORDER_NAME不属于该客户' });
    }
  }

  const orderPaginationRequest = normalizeCustomerHistoryPagination(
    { page: input.orderPage, pageSize: input.orderPageSize },
    { defaultPageSize: input.defaultOrderPageSize },
  );
  const receiptPaginationRequest = normalizeCustomerHistoryPagination(
    { page: input.receiptPage, pageSize: input.receiptPageSize },
    { defaultPageSize: input.defaultReceiptPageSize },
  );

  const orderRows = await db.order.findMany({
    where: combineWhere({ customerId }, input.orderWhere as Record<string, unknown> | undefined),
    include: {
      invoice: {
        select: { invNo: true, shipDate: true, releaseDate: true },
      },
      receipts: {
        select: { usd: true, status: true },
      },
    },
    orderBy: [{ createdAt: 'desc' }],
  });

  const sortedOrders = sortCustomerHistoryOrders(orderRows
    .filter((row) => !normalizedOrderName || orderMatchesOrderName(row.orderNo, normalizedOrderName))
    .map((row) => ({
      id: row.id,
      orderNo: row.orderNo,
      invNo: row.invoice?.invNo || null,
      amount: Number(row.amount),
      outstanding: Array.isArray(row.receipts)
        ? computeOrderBalanceFromReceipts({ amount: row.amount, receipts: row.receipts })
        : Number(row.orderBalance),
      shipDate: row.invoice?.shipDate || null,
      releaseDate: row.invoice?.releaseDate || null,
      createdAt: row.createdAt,
    })));
  const { items: orders, pagination: orderPagination } = paginateCustomerHistoryRows(
    sortedOrders,
    orderPaginationRequest.page,
    orderPaginationRequest.pageSize,
  );

  const receiptWhere = combineWhere({ customerId }, input.receiptWhere as Record<string, unknown> | undefined);
  const totalReceipts = await db.receipt.count({ where: receiptWhere });
  const receiptTotalPages = Math.max(1, Math.ceil(totalReceipts / receiptPaginationRequest.pageSize));
  const receiptPage = Math.min(receiptPaginationRequest.page, receiptTotalPages);
  const receipts = await db.receipt.findMany({
    where: receiptWhere,
    select: {
      id: true,
      receiptNo: true,
      orderNo: true,
      invNo: true,
      usd: true,
      status: true,
      date: true,
      createdAt: true,
      imageUrl: true,
      imageName: true,
      creator: { select: { name: true, email: true } },
      order: { select: { invoice: { select: { invNo: true } } } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    skip: (receiptPage - 1) * receiptPaginationRequest.pageSize,
    take: receiptPaginationRequest.pageSize,
  });

  const orderNames = Array.from(new Set([
    customer.orderName,
    ...customer.orderNames.map((row) => row.orderName),
  ].map(trimStr).filter(Boolean)));

  return {
    data: {
      customer: {
        id: customer.id,
        mark: customer.mark,
        name: customer.name,
      },
      orderNames,
      orders: orders.map(({ shipDate: _shipDate, releaseDate: _releaseDate, createdAt: _createdAt, ...row }) => row),
      orderPagination,
      receipts: receipts.map((row) => ({
        id: row.id,
        receiptNo: row.receiptNo,
        orderNo: row.orderNo,
        invNo: row.invNo,
        boundInvNo: row.order?.invoice?.invNo || row.invNo || null,
        usd: Number(row.usd),
        status: row.status,
        date: toDateText(row.date),
        createdAt: row.createdAt.toISOString(),
        imageUrl: row.imageUrl,
        imageName: row.imageName,
        creatorName: row.creator?.name || null,
        creatorEmail: row.creator?.email || null,
      })),
      receiptPagination: {
        page: receiptPage,
        pageSize: receiptPaginationRequest.pageSize,
        totalItems: totalReceipts,
        totalPages: receiptTotalPages,
      },
    },
  };
}
