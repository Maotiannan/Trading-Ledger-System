import { Prisma } from '@prisma/client';
import { ensureDepositPoolInvoice, ensureSystemPoolInvoice } from '@/lib/matching';
import { buildInvoiceVisibilityWhere, buildOrderVisibilityWhere } from '@/lib/resource-visibility';
import { findOrderIdByNoOrAliasWithExecutor, syncOrderAliases } from '@/lib/order-alias-db';
import { buildOrderNoWithAliases } from '@/lib/order-alias';
import { serializeOrderTokens } from '@/lib/tokenizer';

type ReceiptEditBindingClient = Prisma.TransactionClient;

export type ReceiptEditBindingInput = {
  currentUserId: string;
  ownerIds: string[];
  orderNo: string | null | undefined;
  invNo: string | null | undefined;
  isDeposit: boolean;
  customerId: string | null;
  customerMark: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerCity: string | null;
  needsCustomerFix: boolean;
};

export type ReceiptEditBindingResult = {
  orderId: string | null;
  orderNo: string | null;
  invNo: string | null;
};

export async function syncReceiptDetailItemsForBinding(
  client: ReceiptEditBindingClient,
  params: {
    receiptId: string;
    orderNo: string | null;
    customerMark: string | null;
  },
) {
  await client.detailItem.updateMany({
    where: { receiptId: params.receiptId },
    data: {
      orderNo: params.orderNo,
      mark: params.customerMark,
    },
  });
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

async function findVisibleInvoiceByNo(
  client: ReceiptEditBindingClient,
  invNo: string | null,
  ownerIds: string[],
) {
  return invNo
    ? client.invoice.findFirst({
        where: {
          AND: [
            { invNo },
            buildInvoiceVisibilityWhere(ownerIds),
          ],
        },
        select: { id: true, invNo: true },
      })
    : null;
}

function isSystemPoolInvoiceNo(invNo: string | null | undefined): boolean {
  return invNo === 'Un_Associated' || invNo === 'DEPOSIT_POOL';
}

export async function resolveReceiptEditBinding(
  client: ReceiptEditBindingClient,
  input: ReceiptEditBindingInput,
): Promise<ReceiptEditBindingResult> {
  const requestedOrderNo = cleanText(input.orderNo);
  const requestedInvNo = cleanText(input.invNo);

  if (!requestedOrderNo) {
    return {
      orderId: null,
      orderNo: null,
      invNo: requestedInvNo,
    };
  }

  const visibleOrderWhere = buildOrderVisibilityWhere(input.ownerIds);
  const existingOrderId = await findOrderIdByNoOrAliasWithExecutor(
    client,
    requestedOrderNo,
    visibleOrderWhere,
  );
  if (existingOrderId) {
    const order = await client.order.findUnique({
      where: { id: existingOrderId },
      select: {
        id: true,
        orderNo: true,
        invoiceId: true,
        invoice: { select: { id: true, invNo: true } },
      },
    });
    const targetInvoice = isSystemPoolInvoiceNo(order?.invoice?.invNo) && requestedInvNo
      ? await findVisibleInvoiceByNo(client, requestedInvNo, input.ownerIds)
      : null;
    if (order && targetInvoice && targetInvoice.id !== order.invoiceId) {
      await client.order.update({
        where: { id: existingOrderId },
        data: { invoiceId: targetInvoice.id },
      });
      return {
        orderId: existingOrderId,
        orderNo: order.orderNo || requestedOrderNo,
        invNo: targetInvoice.invNo,
      };
    }
    return {
      orderId: existingOrderId,
      orderNo: order?.orderNo || requestedOrderNo,
      invNo: order?.invoice?.invNo || null,
    };
  }

  const { canonicalOrderNo } = buildOrderNoWithAliases(requestedOrderNo);
  const targetInvoice = await findVisibleInvoiceByNo(client, requestedInvNo, input.ownerIds);

  const invoiceId = targetInvoice?.id
    || (input.isDeposit
      ? await ensureDepositPoolInvoice(input.currentUserId, client)
      : await ensureSystemPoolInvoice(input.currentUserId, client));
  const createdOrder = await client.order.create({
    data: {
      invoiceId,
      orderNo: canonicalOrderNo,
      tokens: serializeOrderTokens(canonicalOrderNo),
      amount: 0,
      orderBalance: 0,
      createdBy: input.currentUserId,
      customerId: input.customerId,
      customerMark: input.customerMark,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      customerCity: input.customerCity,
      needsCustomerFix: input.needsCustomerFix,
    },
  });
  await syncOrderAliases(client, createdOrder.id, canonicalOrderNo);

  return {
    orderId: createdOrder.id,
    orderNo: createdOrder.orderNo || canonicalOrderNo,
    invNo: targetInvoice?.invNo || null,
  };
}
