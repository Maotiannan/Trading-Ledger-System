import { ReceiptGeneratorSessionStatus, ReceiptStatus, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { lookupInvoiceOrderContext } from '@/lib/invoice-read-service';
import { canAccessOwnedResourceAsync } from '@/lib/ownership';
import { createApiError } from '@/lib/api-error';
import {
  buildReceiptGeneratorLayout,
  normalizeReceiptGeneratorFraisStatus,
  normalizeReceiptGeneratorPaymentMode,
  normalizeReceiptGeneratorPaymentType,
  normalizeReceiptGeneratorReceivedBy,
} from '@/lib/receipt-generator-layout';
import { getSuggestedNextReceiptNo } from '@/lib/receipt-number';
import {
  getReceiptGeneratorCustomerCompanyName,
  getReceiptGeneratorCustomerName,
} from '@/lib/receipt-generator-customer';
import {
  classifyPaymentType,
  DEPOSIT_POOL_INVOICE_NO,
  mapPaymentTypeClassificationToReceiptGenerator,
  SYSTEM_POOL_INVOICE_NOS,
} from '@/lib/payment-type-classifier';
import type { CurrentUser } from '@/lib/request-auth';

function badRequest(message: string, detail?: unknown) {
  return createApiError({ code: 'BAD_REQUEST', status: 400, message, detail });
}

function forbidden(message: string, detail?: unknown) {
  return createApiError({ code: 'FORBIDDEN', status: 403, message, detail });
}

function assertGeneratorRole(currentUser: CurrentUser) {
  if (currentUser.role === UserRole.USER) {
    throw forbidden('当前角色无权生成签名收据', { role: currentUser.role });
  }
}

type GeneratorSessionRecord = Awaited<ReturnType<typeof db.receiptGeneratorSession.findUnique>>;

function mapSessionForClient(session: NonNullable<GeneratorSessionRecord>) {
  const snapshot = session.layoutSnapshot && typeof session.layoutSnapshot === 'object'
    ? session.layoutSnapshot as Record<string, unknown>
    : null;
  const layout = buildReceiptGeneratorLayout({
    receiptNo: session.receiptNo,
    orderNo: session.orderNo,
    invNo: session.invNo,
    customerMark: session.customerMark,
    customerCompanyName: typeof snapshot?.customerCompanyName === 'string' ? snapshot.customerCompanyName : null,
    customerName: session.customerName,
    clientNameOverride: typeof snapshot?.clientName === 'string' ? snapshot.clientName : null,
    clientTel: session.clientTel,
    usdAmount: Number(session.usd),
    balanceBefore: session.balanceBefore === null ? null : Number(session.balanceBefore),
    paymentMode: normalizeReceiptGeneratorPaymentMode(snapshot?.paymentMode),
    fraisStatus: normalizeReceiptGeneratorFraisStatus(snapshot?.fraisStatus),
    paymentType: normalizeReceiptGeneratorPaymentType(snapshot?.paymentType),
    receivedBy: normalizeReceiptGeneratorReceivedBy(snapshot?.receivedBy),
    generatedAt: session.createdAt,
    dateText: typeof snapshot?.dateText === 'string' ? snapshot.dateText : null,
  });

  return {
    id: session.id,
    receiptId: session.receiptId,
    receiptNo: session.receiptNo,
    status: session.status,
    layout,
    finalImageUrl: session.finalImageUrl,
    finalImageName: session.finalImageName,
    receiverSignatureUrl: session.receiverSignatureUrl,
    payerSignatureUrl: session.payerSignatureUrl,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

async function suggestReceiptGeneratorPaymentType(input: {
  latestMatch: {
    id: string;
    orderBalance: unknown;
    invoice?: { invNo?: string | null } | null;
  } | null;
  hasCustomer: boolean;
  usdAmount?: number;
}) {
  if (!input.latestMatch) {
    return input.hasCustomer ? 'Deposit' : null;
  }

  const invNo = input.latestMatch.invoice?.invNo ?? null;
  const numericBalanceBefore = Number(input.latestMatch.orderBalance || 0);
  const numericAmount = Number(input.usdAmount);
  const hasAmount = Number.isFinite(numericAmount) && numericAmount > 0;
  const predictedBalanceAfter = hasAmount
    ? Number((numericBalanceBefore - numericAmount).toFixed(2))
    : null;

  const firstFormalReceipt = await db.receipt.findFirst({
    where: {
      orderId: input.latestMatch.id,
      status: { not: ReceiptStatus.SIGNING_PENDING },
    },
    select: { id: true },
    orderBy: [
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
  });

  const classification = classifyPaymentType({
    balanceAfter: predictedBalanceAfter,
    isPoolOrder: Boolean(invNo && SYSTEM_POOL_INVOICE_NOS.has(invNo)),
    isDepositPayment: invNo === DEPOSIT_POOL_INVOICE_NO,
    isFirstPayment: !firstFormalReceipt,
  });

  return mapPaymentTypeClassificationToReceiptGenerator(classification);
}

export async function lookupReceiptGeneratorOrderContext(currentUser: CurrentUser, orderNo: string, usdAmount?: number) {
  assertGeneratorRole(currentUser);

  const context = await lookupInvoiceOrderContext(currentUser, orderNo);
  const exactMatches = Array.isArray(context.data?.exactMatches) ? context.data.exactMatches : [];
  const inferredCustomer = context.data?.inferredCustomer || null;
  const latestMatch = exactMatches[0] || null;
  const resolvedOrderCustomer = exactMatches.find((row) => row.customerId && !row.needsCustomerFix) || null;
  const customer = resolvedOrderCustomer
    ? {
        id: resolvedOrderCustomer.customerId,
        mark: resolvedOrderCustomer.customerMark,
        orderName: context.data?.derivedOrderName || null,
        companyName: getReceiptGeneratorCustomerCompanyName(resolvedOrderCustomer.customer),
        name: getReceiptGeneratorCustomerName(resolvedOrderCustomer.customer, resolvedOrderCustomer.customerName),
        phone: resolvedOrderCustomer.customerPhone,
        city: resolvedOrderCustomer.customerCity,
      }
    : inferredCustomer
      ? {
          id: inferredCustomer.id,
          mark: inferredCustomer.mark,
          orderName: inferredCustomer.orderName,
          companyName: getReceiptGeneratorCustomerCompanyName(inferredCustomer),
          name: inferredCustomer.name,
          phone: inferredCustomer.phone,
          city: inferredCustomer.city,
        }
      : null;

  const invoiceSuggestion = latestMatch
    ? {
        invNo: latestMatch.invoice.invNo,
        conflict: exactMatches.length > 1,
        count: exactMatches.length,
      }
    : null;
  const matchedOrderNo = latestMatch?.orderNo || String(orderNo || '').trim();

  const balanceBefore = latestMatch ? Number(latestMatch.orderBalance || 0) : null;
  const suggestedPaymentType = await suggestReceiptGeneratorPaymentType({
    latestMatch,
    hasCustomer: Boolean(customer),
    usdAmount,
  });
  const receiptPreview = latestMatch && customer
    ? buildReceiptGeneratorLayout({
        receiptNo: 'PENDING',
        orderNo: matchedOrderNo,
        invNo: invoiceSuggestion?.invNo || null,
        customerMark: customer.mark || null,
        customerCompanyName: customer.companyName || null,
        customerName: customer.name || null,
        clientTel: customer.phone || null,
        usdAmount: Number(usdAmount || 0),
        balanceBefore,
      })
    : null;

  return {
    data: {
      orderNo: matchedOrderNo,
      invNo: invoiceSuggestion?.invNo || null,
      invoiceSuggestion,
      customer,
      balanceBefore,
      exactMatchCount: exactMatches.length,
      suggestedPaymentType,
      preview: receiptPreview,
    },
    message: '签名收据订单上下文已加载',
  };
}

export async function getSuggestedReceiptGeneratorNumber(currentUser: CurrentUser) {
  assertGeneratorRole(currentUser);
  const receiptNo = await getSuggestedNextReceiptNo(db);
  return {
    data: { receiptNo },
    message: '签名收据编号建议已加载',
  };
}

export async function getReceiptGeneratorSession(currentUser: CurrentUser, sessionId: string) {
  assertGeneratorRole(currentUser);
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) {
    throw badRequest('缺少签名会话ID');
  }

  const session = await db.receiptGeneratorSession.findUnique({
    where: { id: normalizedSessionId },
    include: {
      receipt: {
        select: {
          id: true,
          createdBy: true,
          status: true,
          imageUrl: true,
          imageName: true,
        },
      },
    },
  });

  if (!session || !session.receipt) {
    throw createApiError({
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
      message: '签名收据会话不存在',
      detail: { sessionId: normalizedSessionId },
    });
  }

  if (!(await canAccessOwnedResourceAsync(session.receipt.createdBy, currentUser))) {
    throw forbidden('无权访问该签名收据会话', {
      sessionId: normalizedSessionId,
      receiptId: session.receiptId,
    });
  }

  return {
    data: {
      ...mapSessionForClient(session),
      receiptStatus: session.receipt.status,
      canFinalize: session.status === ReceiptGeneratorSessionStatus.PENDING,
    },
    message: '签名收据会话已加载',
  };
}

export async function getOpenReceiptGeneratorSessionByReceipt(currentUser: CurrentUser, receiptId: string) {
  assertGeneratorRole(currentUser);
  const normalizedReceiptId = String(receiptId || '').trim();
  if (!normalizedReceiptId) {
    throw badRequest('缺少收据ID');
  }

  const session = await db.receiptGeneratorSession.findFirst({
    where: {
      receiptId: normalizedReceiptId,
      status: ReceiptGeneratorSessionStatus.PENDING,
    },
    include: {
      receipt: {
        select: {
          createdBy: true,
        },
      },
    },
  });

  if (!session || !session.receipt) {
    throw createApiError({
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
      message: '签名收据会话不存在',
      detail: { receiptId: normalizedReceiptId },
    });
  }

  if (!(await canAccessOwnedResourceAsync(session.receipt.createdBy, currentUser))) {
    throw forbidden('无权访问该签名收据会话', {
      receiptId: normalizedReceiptId,
    });
  }

  return {
    data: mapSessionForClient(session),
    message: '签名收据会话已加载',
  };
}
