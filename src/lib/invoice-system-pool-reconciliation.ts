import { updateOrderBalance } from '@/lib/matching';
import {
  SYSTEM_POOL_INVOICE_NOS,
  type DEPOSIT_POOL_INVOICE_NO,
  type UN_ASSOCIATED_POOL_INVOICE_NO,
} from '@/lib/payment-type-classifier';
import {
  findOrderIdByNoOrAliasWithExecutor,
  syncOrderAliases,
} from '@/lib/order-alias-db';
import { serializeOrderTokens } from '@/lib/tokenizer';
import type { DbTransactionClient } from '@/lib/transaction';

export type SystemPoolInvoiceNo =
  | typeof DEPOSIT_POOL_INVOICE_NO
  | typeof UN_ASSOCIATED_POOL_INVOICE_NO;

export type SystemPoolOperationSource =
  | 'INVOICE_WRITE'
  | 'BULK_IMPORT'
  | 'REMATCH_AUTO'
  | 'REMATCH_MANUAL';

export type SystemPoolMigrationAudit = {
  sourceOrderId: string;
  sourcePool: SystemPoolInvoiceNo;
  targetInvoiceId: string;
  targetInvNo: string;
  targetOrderId: string;
  movedReceiptCount: number;
  amountBefore: number;
  amountAfter: number;
  balanceBefore: number;
  balanceAfter: number;
  operationSource: SystemPoolOperationSource;
};

export type SystemPoolCustomerSnapshot = {
  customerId: string | null;
  customerMark: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerCity: string | null;
  needsCustomerFix: boolean;
};

export type SystemPoolMigrationResult = {
  targetOrderId: string;
  audit: SystemPoolMigrationAudit;
};

export async function migrateSystemPoolOrderForInvoiceRow(
  tx: DbTransactionClient,
  input: {
    orderNo: string;
    targetInvoice: { id: string; invNo: string };
    authoritativeAmount: number;
    targetOrderId: string | null;
    customer: SystemPoolCustomerSnapshot;
    operationSource: SystemPoolOperationSource;
  },
): Promise<SystemPoolMigrationResult | null> {
  if (SYSTEM_POOL_INVOICE_NOS.has(input.targetInvoice.invNo)) return null;

  const poolOrderId = await findOrderIdByNoOrAliasWithExecutor(tx, input.orderNo, {
    invoice: { invNo: { in: Array.from(SYSTEM_POOL_INVOICE_NOS) } },
  });
  if (!poolOrderId) return null;

  const source = await tx.order.findUnique({
    where: { id: poolOrderId },
    select: {
      id: true,
      orderNo: true,
      amount: true,
      orderBalance: true,
      invoice: { select: { invNo: true } },
    },
  });
  if (!source || !SYSTEM_POOL_INVOICE_NOS.has(source.invoice.invNo)) return null;

  const sourcePool = source.invoice.invNo as SystemPoolInvoiceNo;
  const movedReceiptCount = await tx.receipt.count({ where: { orderId: source.id } });
  const amountBefore = Number(source.amount);
  const balanceBefore = Number(source.orderBalance);
  const targetOrderId = input.targetOrderId ?? source.id;
  const receiptSnapshot = {
    invNo: input.targetInvoice.invNo,
    orderNo: input.orderNo,
    customerId: input.customer.customerId,
    customerMark: input.customer.customerMark,
    customerName: input.customer.customerName,
    customerPhone: input.customer.customerPhone,
    customerCity: input.customer.customerCity,
    needsCustomerFix: input.customer.needsCustomerFix,
  };

  if (input.targetOrderId) {
    await tx.receipt.updateMany({
      where: { orderId: source.id },
      data: { orderId: input.targetOrderId, ...receiptSnapshot },
    });
    await tx.order.delete({ where: { id: source.id } });
  } else {
    await tx.order.update({
      where: { id: source.id },
      data: {
        invoiceId: input.targetInvoice.id,
        orderNo: input.orderNo,
        tokens: serializeOrderTokens(input.orderNo),
        amount: input.authoritativeAmount,
        customerId: input.customer.customerId,
        customerMark: input.customer.customerMark,
        customerName: input.customer.customerName,
        customerPhone: input.customer.customerPhone,
        customerCity: input.customer.customerCity,
        needsCustomerFix: input.customer.needsCustomerFix,
      },
    });
    await tx.receipt.updateMany({
      where: { orderId: source.id },
      data: receiptSnapshot,
    });
  }

  await syncOrderAliases(tx, targetOrderId, input.orderNo);
  await updateOrderBalance(targetOrderId, tx);

  const target = await tx.order.findUnique({
    where: { id: targetOrderId },
    select: { amount: true, orderBalance: true },
  });

  return {
    targetOrderId,
    audit: {
      sourceOrderId: source.id,
      sourcePool,
      targetInvoiceId: input.targetInvoice.id,
      targetInvNo: input.targetInvoice.invNo,
      targetOrderId,
      movedReceiptCount,
      amountBefore,
      amountAfter: Number(target?.amount ?? input.authoritativeAmount),
      balanceBefore,
      balanceAfter: Number(target?.orderBalance ?? 0),
      operationSource: input.operationSource,
    },
  };
}
