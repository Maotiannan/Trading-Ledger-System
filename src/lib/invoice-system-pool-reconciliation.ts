import type { Prisma } from '@prisma/client';

import { createApiError } from '@/lib/api-error';
import { updateOrderBalance } from '@/lib/matching';
import {
  DEPOSIT_POOL_INVOICE_NO,
  SYSTEM_POOL_INVOICE_NOS,
  UN_ASSOCIATED_POOL_INVOICE_NO,
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

export type SystemPoolRepairPreview = {
  sourceOrderId: string;
  orderNo: string;
  sourcePool: SystemPoolInvoiceNo;
  amount: number;
  orderBalance: number;
  receiptCount: number;
  repairMode: 'AUTO' | 'MANUAL';
  targetOrderId: string | null;
  targetInvoiceId: string | null;
  targetInvNo: string | null;
};

export type SystemPoolRepairTargetInvoice = {
  id: string;
  invNo: string;
};

type VerifiedSystemPoolOrder = {
  id: string;
  orderNo: string;
  amount: unknown;
  orderBalance: unknown;
  customerId: string | null;
  customerMark: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerCity: string | null;
  needsCustomerFix: boolean;
  invoice: { invNo: string };
};

const verifiedSystemPoolOrderSelect = {
  id: true,
  orderNo: true,
  amount: true,
  orderBalance: true,
  customerId: true,
  customerMark: true,
  customerName: true,
  customerPhone: true,
  customerCity: true,
  needsCustomerFix: true,
  invoice: { select: { invNo: true } },
} as const;

function repairConflict(message: string, detail?: unknown) {
  return createApiError({ code: 'CONFLICT', status: 409, message, detail });
}

async function applyVerifiedSystemPoolMove(
  tx: DbTransactionClient,
  input: {
    source: VerifiedSystemPoolOrder;
    targetInvoice: { id: string; invNo: string };
    authoritativeAmount: number;
    targetOrderId: string | null;
    canonicalOrderNo: string;
    customer: SystemPoolCustomerSnapshot;
    operationSource: SystemPoolOperationSource;
  },
): Promise<SystemPoolMigrationResult> {
  const source = input.source;
  const sourcePool = source.invoice.invNo as SystemPoolInvoiceNo;
  const movedReceiptCount = await tx.receipt.count({ where: { orderId: source.id } });
  const amountBefore = Number(source.amount);
  const balanceBefore = Number(source.orderBalance);
  const targetOrderId = input.targetOrderId ?? source.id;
  const receiptSnapshot = {
    invNo: input.targetInvoice.invNo,
    orderNo: input.canonicalOrderNo,
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
        orderNo: input.canonicalOrderNo,
        tokens: serializeOrderTokens(input.canonicalOrderNo),
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

  await syncOrderAliases(tx, targetOrderId, input.canonicalOrderNo);
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

export async function previewSystemPoolRepairs(
  tx: DbTransactionClient,
  input: {
    orderWhere: Prisma.OrderWhereInput;
    invoiceWhere: Prisma.InvoiceWhereInput;
  },
): Promise<{
  poolRepairs: SystemPoolRepairPreview[];
  targetInvoices: SystemPoolRepairTargetInvoice[];
}> {
  const poolInvoiceNos = Array.from(SYSTEM_POOL_INVOICE_NOS);
  const formalOrderWhere: Prisma.OrderWhereInput = {
    AND: [
      input.orderWhere,
      { invoice: { invNo: { notIn: poolInvoiceNos } } },
    ],
  };
  const poolOrders = await tx.order.findMany({
    where: {
      AND: [
        input.orderWhere,
        { invoice: { invNo: { in: poolInvoiceNos } } },
      ],
    },
    select: {
      id: true,
      orderNo: true,
      amount: true,
      orderBalance: true,
      invoice: { select: { invNo: true } },
      _count: { select: { receipts: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const targetInvoices = await tx.invoice.findMany({
    where: {
      AND: [
        input.invoiceWhere,
        { invNo: { notIn: poolInvoiceNos } },
      ],
    },
    select: { id: true, invNo: true },
    orderBy: { invNo: 'asc' },
  });

  const poolRepairs: SystemPoolRepairPreview[] = [];
  for (const poolOrder of poolOrders) {
    const firstId = await findOrderIdByNoOrAliasWithExecutor(
      tx,
      poolOrder.orderNo,
      formalOrderWhere,
    );
    const secondId = firstId
      ? await findOrderIdByNoOrAliasWithExecutor(tx, poolOrder.orderNo, {
          AND: [
            input.orderWhere,
            { invoice: { invNo: { notIn: poolInvoiceNos } } },
            { id: { not: firstId } },
          ],
        })
      : null;
    const target = firstId && !secondId
      ? await tx.order.findUnique({
          where: { id: firstId },
          select: {
            id: true,
            invoiceId: true,
            invoice: { select: { invNo: true } },
          },
        })
      : null;
    const repairMode = target ? 'AUTO' : Number(poolOrder.amount) > 0 ? 'MANUAL' : null;
    if (!repairMode) continue;

    poolRepairs.push({
      sourceOrderId: poolOrder.id,
      orderNo: poolOrder.orderNo,
      sourcePool: poolOrder.invoice.invNo as SystemPoolInvoiceNo,
      amount: Number(poolOrder.amount),
      orderBalance: Number(poolOrder.orderBalance),
      receiptCount: poolOrder._count.receipts,
      repairMode,
      targetOrderId: target?.id ?? null,
      targetInvoiceId: target?.invoiceId ?? null,
      targetInvNo: target?.invoice.invNo ?? null,
    });
  }

  return { poolRepairs, targetInvoices };
}

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
    select: verifiedSystemPoolOrderSelect,
  });
  if (!source || !SYSTEM_POOL_INVOICE_NOS.has(source.invoice.invNo)) return null;

  return applyVerifiedSystemPoolMove(tx, {
    source,
    targetInvoice: input.targetInvoice,
    authoritativeAmount: input.authoritativeAmount,
    targetOrderId: input.targetOrderId,
    canonicalOrderNo: input.orderNo,
    customer: input.customer,
    operationSource: input.operationSource,
  });
}

function customerSnapshotFromOrder(order: VerifiedSystemPoolOrder): SystemPoolCustomerSnapshot {
  return {
    customerId: order.customerId,
    customerMark: order.customerMark,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerCity: order.customerCity,
    needsCustomerFix: order.needsCustomerFix,
  };
}

export async function applySystemPoolRepairs(
  tx: DbTransactionClient,
  input: {
    orderWhere: Prisma.OrderWhereInput;
    invoiceWhere: Prisma.InvoiceWhereInput;
    poolResolutions: Array<{ sourceOrderId: string; targetInvoiceId: string }>;
    requireAllManual: boolean;
  },
): Promise<{
  autoMigrations: SystemPoolMigrationAudit[];
  manualMigrations: SystemPoolMigrationAudit[];
  skipped: number;
  unresolvedManual: number;
}> {
  const preview = await previewSystemPoolRepairs(tx, input);
  const manualRows = preview.poolRepairs.filter((row) => row.repairMode === 'MANUAL');
  const resolutionBySource = new Map(
    input.poolResolutions
      .filter((row) => row.sourceOrderId && row.targetInvoiceId)
      .map((row) => [row.sourceOrderId, row.targetInvoiceId]),
  );
  const unresolvedManual = manualRows.filter(
    (row) => !resolutionBySource.has(row.sourceOrderId),
  ).length;
  if (input.requireAllManual && unresolvedManual > 0) {
    throw repairConflict('请选择所有待修复订单的目标账单', { unresolvedManual });
  }

  const poolInvoiceNos = Array.from(SYSTEM_POOL_INVOICE_NOS);
  const sourceWhere = (sourceOrderId: string): Prisma.OrderWhereInput => ({
    AND: [
      { id: sourceOrderId },
      input.orderWhere,
      { invoice: { invNo: { in: poolInvoiceNos } } },
    ],
  });
  const formalOrderWhere = (orderId: string): Prisma.OrderWhereInput => ({
    AND: [
      { id: orderId },
      input.orderWhere,
      { invoice: { invNo: { notIn: poolInvoiceNos } } },
    ],
  });
  const autoMigrations: SystemPoolMigrationAudit[] = [];
  const manualMigrations: SystemPoolMigrationAudit[] = [];
  let skipped = input.poolResolutions.filter(
    (row) => !manualRows.some((manual) => manual.sourceOrderId === row.sourceOrderId),
  ).length;

  for (const row of preview.poolRepairs.filter((candidate) => candidate.repairMode === 'AUTO')) {
    if (!row.targetOrderId) continue;
    const [source, target] = await Promise.all([
      tx.order.findFirst({ where: sourceWhere(row.sourceOrderId), select: verifiedSystemPoolOrderSelect }),
      tx.order.findFirst({ where: formalOrderWhere(row.targetOrderId), select: {
        ...verifiedSystemPoolOrderSelect,
        invoice: { select: { id: true, invNo: true } },
      } }),
    ]);
    if (!source || !target) {
      skipped += 1;
      continue;
    }
    const moved = await applyVerifiedSystemPoolMove(tx, {
      source,
      targetInvoice: { id: target.invoice.id, invNo: target.invoice.invNo },
      authoritativeAmount: Number(target.amount),
      targetOrderId: target.id,
      canonicalOrderNo: target.orderNo,
      customer: customerSnapshotFromOrder(target),
      operationSource: 'REMATCH_AUTO',
    });
    autoMigrations.push(moved.audit);
  }

  for (const row of manualRows) {
    const targetInvoiceId = resolutionBySource.get(row.sourceOrderId);
    if (!targetInvoiceId) continue;
    const source = await tx.order.findFirst({
      where: sourceWhere(row.sourceOrderId),
      select: verifiedSystemPoolOrderSelect,
    });
    if (!source) {
      skipped += 1;
      continue;
    }
    if (Number(source.amount) <= 0) {
      throw repairConflict('零金额系统池订单不能人工迁移', { sourceOrderId: source.id });
    }
    const targetInvoice = await tx.invoice.findFirst({
      where: {
        AND: [
          { id: targetInvoiceId },
          input.invoiceWhere,
          { invNo: { notIn: poolInvoiceNos } },
        ],
      },
      select: { id: true, invNo: true },
    });
    if (!targetInvoice) {
      throw repairConflict('目标账单不存在、不可见或不是正式账单', {
        sourceOrderId: source.id,
        targetInvoiceId,
      });
    }

    const targetOrderId = await findOrderIdByNoOrAliasWithExecutor(tx, source.orderNo, {
      AND: [input.orderWhere, { invoiceId: targetInvoice.id }],
    });
    const targetOrder = targetOrderId
      ? await tx.order.findFirst({
          where: formalOrderWhere(targetOrderId),
          select: verifiedSystemPoolOrderSelect,
        })
      : null;
    const moved = await applyVerifiedSystemPoolMove(tx, {
      source,
      targetInvoice,
      authoritativeAmount: targetOrder ? Number(targetOrder.amount) : Number(source.amount),
      targetOrderId: targetOrder?.id ?? null,
      canonicalOrderNo: targetOrder?.orderNo ?? source.orderNo,
      customer: customerSnapshotFromOrder(targetOrder ?? source),
      operationSource: 'REMATCH_MANUAL',
    });
    manualMigrations.push(moved.audit);
  }

  return { autoMigrations, manualMigrations, skipped, unresolvedManual };
}
