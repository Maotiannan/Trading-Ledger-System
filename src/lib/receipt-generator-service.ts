import {
  Prisma,
  ReceiptGeneratorSessionStatus,
  ReceiptStatus,
  UploadedAssetAttachmentType,
  UploadedAssetCategory,
  UploadedAssetStatus,
  UserRole,
} from '@prisma/client';
import { rm } from 'fs/promises';
import { db } from '@/lib/db';
import { createApiError } from '@/lib/api-error';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { allocateNextReceiptNo } from '@/lib/receipt-number';
import {
  buildReceiptGeneratorLayout,
  normalizeReceiptGeneratorPaymentMode,
  normalizeReceiptGeneratorPaymentType,
  normalizeReceiptGeneratorReceivedBy,
} from '@/lib/receipt-generator-layout';
import { saveReceiptGeneratorArtifact } from '@/lib/receipt-generator-image';
import { canAccessOwnedResourceAsync } from '@/lib/ownership';
import { runInTransaction } from '@/lib/transaction';
import { lookupInvoiceOrderContext } from '@/lib/invoice-read-service';
import { ensureDepositPoolInvoice, updateOrderBalance } from '@/lib/matching';
import { syncOrderAliases } from '@/lib/order-alias-db';
import { resolveUploadedAssetAbsolutePath } from '@/lib/uploaded-asset-service';
import {
  getReceiptGeneratorCustomerCompanyName,
  getReceiptGeneratorCustomerName,
} from '@/lib/receipt-generator-customer';
import type { CurrentUser } from '@/lib/request-auth';

function badRequest(message: string, detail?: unknown) {
  return createApiError({ code: 'BAD_REQUEST', status: 400, message, detail });
}

function forbidden(message: string, detail?: unknown) {
  return createApiError({ code: 'FORBIDDEN', status: 403, message, detail });
}

function isReceiptNoUniqueError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== 'P2002') return false;
  const target = candidate.meta?.target;
  return Array.isArray(target)
    ? target.includes('receiptNo')
    : String(target || '').includes('receiptNo');
}

function receiptNoConflict(receiptNo: string | null | undefined) {
  const normalizedReceiptNo = receiptNo?.trim() || null;
  return createApiError({
    code: 'CONFLICT',
    status: 409,
    message: normalizedReceiptNo
      ? `收据号 ${normalizedReceiptNo} 已存在，请换一个编号`
      : '收据号已存在，请换一个编号',
    detail: { receiptNo: normalizedReceiptNo },
  });
}

function requireGeneratorRole(currentUser: CurrentUser) {
  if (currentUser.role === UserRole.USER) {
    throw forbidden('当前角色无权生成签名收据', { role: currentUser.role });
  }
}

function sanitizePositiveAmount(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw badRequest('收款金额无效', { value });
  }
  return Number(amount.toFixed(2));
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function createDepositOrderForGenerator(tx: Prisma.TransactionClient, params: {
  orderNo: string;
  usd: number;
  customerId: string;
  customerMark: string;
  customerName: string;
  customerPhone: string | null;
  customerCity: string | null;
  currentUserId: string;
}) {
  const invoiceId = await ensureDepositPoolInvoice(params.currentUserId, tx);
  const created = await tx.order.create({
    data: {
      invoiceId,
      orderNo: params.orderNo,
      amount: 0,
      orderBalance: -params.usd,
      createdBy: params.currentUserId,
      customerId: params.customerId,
      customerMark: params.customerMark,
      customerName: params.customerName,
      customerPhone: params.customerPhone,
      customerCity: params.customerCity,
      needsCustomerFix: false,
    },
  });
  await syncOrderAliases(tx, created.id, params.orderNo);
  return created.id;
}

function fileToBuffer(file: File) {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer().then((data) => Buffer.from(data));
  }
  return new Response(file).arrayBuffer().then((data) => Buffer.from(data));
}

async function buildCreationContext(currentUser: CurrentUser, rawOrderNo: string, usdAmount: number, options: {
  allowDepositPoolOrder?: boolean;
} = {}) {
  const context = await lookupInvoiceOrderContext(currentUser, rawOrderNo);
  const exactMatches = Array.isArray(context.data?.exactMatches) ? context.data.exactMatches : [];
  const latestMatch = exactMatches[0] || null;
  const resolvedCustomerOrder = exactMatches.find((row) => row.customerId && !row.needsCustomerFix) || null;
  const inferredCustomer = context.data?.inferredCustomer || null;
  const customer = resolvedCustomerOrder
    ? {
        id: resolvedCustomerOrder.customerId,
        mark: resolvedCustomerOrder.customerMark,
        companyName: getReceiptGeneratorCustomerCompanyName(resolvedCustomerOrder.customer),
        name: getReceiptGeneratorCustomerName(resolvedCustomerOrder.customer, resolvedCustomerOrder.customerName),
        phone: resolvedCustomerOrder.customerPhone,
        city: resolvedCustomerOrder.customerCity,
      }
    : inferredCustomer
      ? {
          id: inferredCustomer.id,
          mark: inferredCustomer.mark,
          companyName: getReceiptGeneratorCustomerCompanyName(inferredCustomer),
          name: inferredCustomer.name,
          phone: inferredCustomer.phone,
          city: inferredCustomer.city,
        }
      : null;

  if (!latestMatch && !options.allowDepositPoolOrder) {
    throw badRequest('未找到对应订单，无法生成签名收据', { orderNo: rawOrderNo });
  }
  if (!customer?.id || !customer?.mark || !customer?.name) {
    throw badRequest('订单未能唯一匹配客户，请先修复客户信息', {
      orderNo: rawOrderNo,
      derivedOrderName: context.data?.derivedOrderName || null,
    });
  }

  const balanceBefore = latestMatch ? Number(latestMatch.orderBalance || 0) : null;
  const matchedOrderNo = latestMatch?.orderNo || rawOrderNo;
  const matchedInvNo = latestMatch?.invoice?.invNo || null;
  const layout = buildReceiptGeneratorLayout({
      receiptNo: 'PENDING',
      orderNo: matchedOrderNo,
      invNo: matchedInvNo,
      customerMark: customer.mark,
      customerCompanyName: customer.companyName || null,
      customerName: customer.name,
      clientTel: customer.phone || null,
      usdAmount,
      balanceBefore,
      paymentMode: 'Cash',
  });

  return {
    orderId: latestMatch?.id || null,
    orderNo: matchedOrderNo,
    invNo: matchedInvNo,
    customerId: customer.id,
    customerMark: customer.mark,
    customerCompanyName: customer.companyName || null,
    customerName: customer.name,
    customerPhone: customer.phone || null,
    customerCity: customer.city || null,
    balanceBefore,
    layout,
  };
}

export async function createReceiptGeneratorSession(currentUser: CurrentUser, input: {
  orderNo: string;
  usdAmount: number;
  paymentMode?: string | null;
  paymentType?: string | null;
  receivedBy?: string | null;
}) {
  requireGeneratorRole(currentUser);
  const orderNo = trimString(input.orderNo);
  if (!orderNo) {
    throw badRequest('ORDER NO 不能为空');
  }
  const usdAmount = sanitizePositiveAmount(input.usdAmount);
  const paymentMode = normalizeReceiptGeneratorPaymentMode(input.paymentMode);
  const paymentType = normalizeReceiptGeneratorPaymentType(input.paymentType);
  const receivedBy = normalizeReceiptGeneratorReceivedBy(input.receivedBy);
  const isDeposit = paymentType === 'Deposit';
  const creationContext = await buildCreationContext(currentUser, orderNo, usdAmount, {
    allowDepositPoolOrder: isDeposit,
  });
  const effectiveOrderNo = creationContext.orderNo;

  let result;
  try {
    result = await runInTransaction(async (tx) => {
      const receiptNo = await allocateNextReceiptNo(tx);
      const orderId = creationContext.orderId || (isDeposit
        ? await createDepositOrderForGenerator(tx, {
            orderNo: effectiveOrderNo,
            usd: usdAmount,
            customerId: creationContext.customerId,
            customerMark: creationContext.customerMark,
            customerName: creationContext.customerName,
            customerPhone: creationContext.customerPhone,
            customerCity: creationContext.customerCity,
            currentUserId: currentUser.id,
          })
        : null);
      const finalizedLayout = buildReceiptGeneratorLayout({
        receiptNo,
        orderNo: effectiveOrderNo,
        invNo: creationContext.invNo,
        customerMark: creationContext.customerMark,
        customerCompanyName: creationContext.customerCompanyName,
        customerName: creationContext.customerName,
        clientTel: creationContext.customerPhone,
        usdAmount,
        balanceBefore: creationContext.balanceBefore,
        paymentMode,
        paymentType,
        receivedBy,
      });

      const receipt = await tx.receipt.create({
        data: {
          receiptNo,
          date: new Date(),
          tel: creationContext.customerPhone,
          usd: usdAmount,
          invNo: creationContext.invNo,
          orderNo: effectiveOrderNo,
          payer: finalizedLayout.clientName,
          status: ReceiptStatus.SIGNING_PENDING,
          isDeposit,
          customerId: creationContext.customerId,
          customerMark: creationContext.customerMark,
          customerName: creationContext.customerName,
          customerPhone: creationContext.customerPhone,
          customerCity: creationContext.customerCity,
          needsCustomerFix: false,
          orderId,
          createdBy: currentUser.id,
          note: '签名收据待完成',
        },
        select: {
          id: true,
          receiptNo: true,
          status: true,
        },
      });

      const session = await tx.receiptGeneratorSession.create({
        data: {
          receiptId: receipt.id,
          receiptNo,
          orderNo: effectiveOrderNo,
          invNo: creationContext.invNo,
          customerId: creationContext.customerId,
          customerMark: creationContext.customerMark,
          customerName: creationContext.customerName,
          clientTel: creationContext.customerPhone,
          usd: usdAmount,
          balanceBefore: creationContext.balanceBefore,
          balanceAfter: finalizedLayout.balanceAfter,
          amountInWords: finalizedLayout.amountInWords,
          motif: finalizedLayout.motif,
          layoutSnapshot: finalizedLayout,
          status: ReceiptGeneratorSessionStatus.PENDING,
          createdBy: currentUser.id,
        },
        select: {
          id: true,
          receiptId: true,
          receiptNo: true,
          status: true,
        },
      });

      return { receipt, session, layout: finalizedLayout };
    });
  } catch (error) {
    if (isReceiptNoUniqueError(error)) {
      throw receiptNoConflict(null);
    }
    throw error;
  }

  await recordAuditEvent({
    action: auditActions.RECEIPT_CREATE,
    actorId: currentUser.id,
    targetType: auditTargetTypes.RECEIPT,
    targetId: result.receipt.id,
    metadata: {
      mode: 'generator-session',
      receiptNo: result.receipt.receiptNo,
    },
  });

  return {
    data: {
      sessionId: result.session.id,
      receiptId: result.receipt.id,
      receiptNo: result.receipt.receiptNo,
      status: result.receipt.status,
      layout: result.layout,
      signingPath: `/receipt-generator/${result.session.id}`,
    },
    message: '签名收据会话已创建',
  };
}

export async function finalizeReceiptGeneratorSession(currentUser: CurrentUser, input: {
  sessionId: string;
  receiptImage: File;
  receiverSignature: File;
  payerSignature: File;
  layoutSnapshot?: unknown;
}) {
  requireGeneratorRole(currentUser);
  const sessionId = trimString(input.sessionId);
  if (!sessionId) {
    throw badRequest('缺少签名会话ID');
  }
  if (!input.receiptImage || !input.receiverSignature || !input.payerSignature) {
    throw badRequest('签名或收据图片缺失');
  }

  const session = await db.receiptGeneratorSession.findUnique({
    where: { id: sessionId },
    include: {
      receipt: {
        select: {
          id: true,
          orderId: true,
          createdBy: true,
          status: true,
          receiptNo: true,
        },
      },
    },
  });

  if (!session || !session.receipt) {
    throw createApiError({
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
      message: '签名收据会话不存在',
      detail: { sessionId },
    });
  }
  if (!(await canAccessOwnedResourceAsync(session.receipt.createdBy, currentUser))) {
    throw forbidden('无权完成该签名收据', {
      sessionId,
      receiptId: session.receipt.id,
    });
  }
  if (session.status !== ReceiptGeneratorSessionStatus.PENDING || session.receipt.status !== ReceiptStatus.SIGNING_PENDING) {
    throw badRequest('签名收据会话已结束或收据状态无效', {
      sessionId,
      sessionStatus: session.status,
      receiptStatus: session.receipt.status,
    });
  }
  const receipt = session.receipt;

  const [receiptBuffer, receiverSignatureBuffer, payerSignatureBuffer] = await Promise.all([
    fileToBuffer(input.receiptImage),
    fileToBuffer(input.receiverSignature),
    fileToBuffer(input.payerSignature),
  ]);

  const savedArtifacts: Array<{ path: string }> = [];
  let updated;

  try {
    const receiptImage = await saveReceiptGeneratorArtifact({
      kind: 'receipt',
      receiptNo: session.receiptNo,
      buffer: receiptBuffer,
      mime: input.receiptImage.type || 'image/png',
    });
    savedArtifacts.push(receiptImage);

    const receiverSignature = await saveReceiptGeneratorArtifact({
      kind: 'receiver-signature',
      receiptNo: session.receiptNo,
      buffer: receiverSignatureBuffer,
      mime: input.receiverSignature.type || 'image/png',
    });
    savedArtifacts.push(receiverSignature);

    const payerSignature = await saveReceiptGeneratorArtifact({
      kind: 'payer-signature',
      receiptNo: session.receiptNo,
      buffer: payerSignatureBuffer,
      mime: input.payerSignature.type || 'image/png',
    });
    savedArtifacts.push(payerSignature);

    updated = await runInTransaction(async (tx) => {
      const sessionUpdateData: Prisma.ReceiptGeneratorSessionUpdateInput = {
        status: ReceiptGeneratorSessionStatus.FINALIZED,
        receiverSignatureUrl: receiverSignature.path,
        receiverSignatureName: receiverSignature.name,
        payerSignatureUrl: payerSignature.path,
        payerSignatureName: payerSignature.name,
        finalImageUrl: receiptImage.path,
        finalImageName: receiptImage.name,
        ...(typeof input.layoutSnapshot === 'undefined' ? {} : { layoutSnapshot: input.layoutSnapshot as Prisma.InputJsonValue }),
      };

      await tx.receipt.update({
        where: { id: receipt.id },
        data: {
          status: ReceiptStatus.SR_Received,
          imageUrl: receiptImage.path,
          imageName: receiptImage.name,
          note: '签名收据已生成',
        },
      });

      if (receipt.orderId) {
        await updateOrderBalance(receipt.orderId, tx);
      }

      await tx.uploadedAsset.createMany({
        data: [
          {
            path: receiverSignature.path,
            name: receiverSignature.name,
            category: UploadedAssetCategory.RECEIPT_GENERATOR_SIGNATURE,
            mimeType: input.receiverSignature.type || 'image/png',
            sizeBytes: receiverSignatureBuffer.byteLength,
            createdBy: session.createdBy,
            status: UploadedAssetStatus.ATTACHED,
            attachedType: UploadedAssetAttachmentType.RECEIPT_GENERATOR_SESSION,
            attachedId: session.id,
          },
          {
            path: payerSignature.path,
            name: payerSignature.name,
            category: UploadedAssetCategory.RECEIPT_GENERATOR_SIGNATURE,
            mimeType: input.payerSignature.type || 'image/png',
            sizeBytes: payerSignatureBuffer.byteLength,
            createdBy: session.createdBy,
            status: UploadedAssetStatus.ATTACHED,
            attachedType: UploadedAssetAttachmentType.RECEIPT_GENERATOR_SESSION,
            attachedId: session.id,
          },
          {
            path: receiptImage.path,
            name: receiptImage.name,
            category: UploadedAssetCategory.RECEIPT_GENERATOR_FINAL,
            mimeType: input.receiptImage.type || 'image/png',
            sizeBytes: receiptBuffer.byteLength,
            createdBy: session.createdBy,
            status: UploadedAssetStatus.ATTACHED,
            attachedType: UploadedAssetAttachmentType.RECEIPT,
            attachedId: receipt.id,
          },
        ],
      });

      return tx.receiptGeneratorSession.update({
        where: { id: sessionId },
        data: sessionUpdateData,
        include: {
          receipt: {
            select: {
              id: true,
              receiptNo: true,
              status: true,
              imageUrl: true,
              imageName: true,
            },
          },
        },
      });
    });
  } catch (error) {
    await Promise.all(
      savedArtifacts.map((artifact) =>
        rm(resolveUploadedAssetAbsolutePath(artifact.path), { force: true }).catch(() => undefined),
      ),
    );
    throw error;
  }

  await recordAuditEvent({
    action: auditActions.RECEIPT_UPDATE,
    actorId: currentUser.id,
    targetType: auditTargetTypes.RECEIPT,
    targetId: receipt.id,
    metadata: {
      mode: 'generator-finalize',
      sessionId,
      receiptNo: session.receiptNo,
    },
  });

  return {
    data: {
      sessionId,
      receiptId: updated.receipt?.id || session.receiptId,
      receiptNo: session.receiptNo,
      imageUrl: updated.finalImageUrl,
      imageName: updated.finalImageName,
      receiptStatus: updated.receipt?.status || ReceiptStatus.SR_Received,
    },
    message: '签名收据已生成',
  };
}
