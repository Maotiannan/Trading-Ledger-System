import { ReceiptGeneratorSessionStatus, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { lookupInvoiceOrderContext } from '@/lib/invoice-read-service';
import { canAccessOwnedResourceAsync } from '@/lib/ownership';
import { createApiError } from '@/lib/api-error';
import { buildReceiptGeneratorLayout } from '@/lib/receipt-generator-layout';
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
  const layout = buildReceiptGeneratorLayout({
    receiptNo: session.receiptNo,
    orderNo: session.orderNo,
    invNo: session.invNo,
    customerMark: session.customerMark,
    customerName: session.customerName,
    clientTel: session.clientTel,
    usdAmount: Number(session.usd),
    balanceBefore: session.balanceBefore === null ? null : Number(session.balanceBefore),
    generatedAt: session.createdAt,
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
        name: resolvedOrderCustomer.customerName,
        phone: resolvedOrderCustomer.customerPhone,
        city: resolvedOrderCustomer.customerCity,
      }
    : inferredCustomer;

  const invoiceSuggestion = latestMatch
    ? {
        invNo: latestMatch.invoice.invNo,
        conflict: exactMatches.length > 1,
        count: exactMatches.length,
      }
    : null;

  const balanceBefore = latestMatch ? Number(latestMatch.orderBalance || 0) : null;
  const receiptPreview = latestMatch && customer
    ? buildReceiptGeneratorLayout({
        receiptNo: 'PENDING',
        orderNo: String(orderNo || '').trim(),
        invNo: invoiceSuggestion?.invNo || null,
        customerMark: customer.mark || null,
        customerName: customer.name || null,
        clientTel: customer.phone || null,
        usdAmount: Number(usdAmount || 0),
        balanceBefore,
      })
    : null;

  return {
    data: {
      orderNo: String(orderNo || '').trim(),
      invNo: invoiceSuggestion?.invNo || null,
      invoiceSuggestion,
      customer,
      balanceBefore,
      exactMatchCount: exactMatches.length,
      preview: receiptPreview,
    },
    message: '签名收据订单上下文已加载',
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
