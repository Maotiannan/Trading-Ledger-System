import { db } from '@/lib/db';
import { ReceiptStatus } from '@prisma/client';
import { calculateOrderSimilarity, parseOrderTokens, serializeOrderTokens } from '@/lib/tokenizer';
import { buildOrderNoWithAliases, normalizeOrderNo } from '@/lib/order-alias';
import { findOrderIdByNoOrAlias, mapOrderIdsByOrderNos, syncOrderAliases } from '@/lib/order-alias-db';
import type { DbTransactionClient } from '@/lib/transaction';
import { runInTransaction } from '@/lib/transaction';

type MatchingWriteClient = Pick<DbTransactionClient, 'invoice' | 'order' | 'receipt' | 'systemSetting'>;

export type FindMatchingReceiptOptions = {
  statuses?: ReceiptStatus[];
  requireAmountTolerance?: boolean;
};

// 确保DEPOSIT_POOL发票池存在
export async function ensureDepositPoolInvoice(userId: string, client: MatchingWriteClient = db): Promise<string> {
  // 查找或创建DEPOSIT_POOL发票
  let invoice = await client.invoice.findFirst({
    where: { invNo: 'DEPOSIT_POOL' }
  });

  if (!invoice) {
    invoice = await client.invoice.create({
      data: {
        invNo: 'DEPOSIT_POOL',
        createdBy: userId
      }
    });
  }

  return invoice.id;
}

// 确保Un_Associated发票池存在（用于自动创建的订单）
export async function ensureSystemPoolInvoice(userId: string, client: MatchingWriteClient = db): Promise<string> {
  // 查找或创建Un_Associated发票
  let invoice = await client.invoice.findFirst({
    where: { invNo: 'Un_Associated' }
  });

  if (!invoice) {
    invoice = await client.invoice.create({
      data: {
        invNo: 'Un_Associated',
        createdBy: userId
      }
    });
  }

  return invoice.id;
}

// 创建新的Order
export async function createOrder(orderNo: string, userId: string, client?: MatchingWriteClient): Promise<string> {
  const { canonicalOrderNo } = buildOrderNoWithAliases(orderNo);

  if (client) {
    const invoiceId = await ensureSystemPoolInvoice(userId, client);
    const created = await client.order.create({
      data: {
        invoiceId,
        orderNo: canonicalOrderNo,
        tokens: serializeOrderTokens(canonicalOrderNo),
        amount: 0,
        orderBalance: 0,
        createdBy: userId,
        needsCustomerFix: true,
      }
    });
    await syncOrderAliases(client as DbTransactionClient, created.id, canonicalOrderNo);
    return created.id;
  }

  try {
    const order = await runInTransaction(async (tx) => {
      const invoiceId = await ensureSystemPoolInvoice(userId, tx);
      const created = await tx.order.create({
        data: {
          invoiceId,
          orderNo: canonicalOrderNo,
          tokens: serializeOrderTokens(canonicalOrderNo),
          amount: 0, // 初始金额为0，会随着收据累加
          orderBalance: 0,
          createdBy: userId,
          needsCustomerFix: true,
        }
      });
      await syncOrderAliases(tx, created.id, canonicalOrderNo);
      return created;
    });

    return order.id;
  } catch (error: unknown) {
    const prismaError = error as { code?: string };
    if (prismaError.code !== 'P2002') {
      throw error;
    }

    const existingId = await findOrderIdByNoOrAlias(canonicalOrderNo);
    if (existingId) return existingId;
    throw error;
  }
}

// 查找或创建Order
export async function findOrCreateOrder(orderNo: string, userId: string, client?: MatchingWriteClient): Promise<string> {
  const normalizedInput = normalizeOrderNo(orderNo);
  if (!normalizedInput) {
    return createOrder(orderNo, userId, client);
  }

  const directId = await findOrderIdByNoOrAlias(orderNo);
  if (directId) return directId;

  // 查找所有订单
  const orders = await db.order.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, orderNo: true, tokens: true }
  });

  // 查找匹配分数最高的订单
  let bestMatch: { id: string; score: number } | null = null;
  for (const order of orders) {
    const score = calculateOrderSimilarity(orderNo, order.orderNo, parseOrderTokens(order.tokens));
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { id: order.id, score };
    }
  }

  if (bestMatch && bestMatch.score >= 0.72) {
    return bestMatch.id;
  }

  // 没找到，创建新的
  return createOrder(orderNo, userId, client);
}

// 模糊匹配ORDER
// 规则：管理员创建的ORDER名应该包含识别的ORDER，子串匹配，不区分大小写
export async function findMatchingOrder(orderNo: string | null): Promise<{
  orderId: string;
  orderNo: string;
  amount: number;
  orderBalance: number;
} | null> {
  if (!orderNo) return null;
  const normalizedOrderNo = normalizeOrderNo(orderNo);
  if (!normalizedOrderNo) return null;

  const directOrderId = await findOrderIdByNoOrAlias(orderNo);
  if (directOrderId) {
    const direct = await db.order.findUnique({
      where: { id: directOrderId },
      select: { id: true, orderNo: true, amount: true, orderBalance: true },
    });
    if (direct) {
      return {
        orderId: direct.id,
        orderNo: direct.orderNo,
        amount: Number(direct.amount),
        orderBalance: Number(direct.orderBalance),
      };
    }
  }

  // 查找所有订单，按创建时间排序
  const orders = await db.order.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      orderNo: true,
      amount: true,
      orderBalance: true,
      tokens: true,
    }
  });

  // 先做精确匹配
  const exact = orders.find((order) => order.orderNo.toLowerCase().trim() === normalizedOrderNo);
  if (exact) {
    return {
      orderId: exact.id,
      orderNo: exact.orderNo,
      amount: Number(exact.amount),
      orderBalance: Number(exact.orderBalance),
    };
  }

  // 收据入账不能用同前缀或相似度兜底；未登记订单必须进入系统池等待管理员处理。
  return null;
}

// 动态规划算法：在数值集合中寻找子集，其和等于目标值
// 用于匹配DETAIL金额与多个RECEIPT金额
export function findSubsetSum(
  target: number,
  candidates: { id: string; amount: number }[]
): string[] | null {
  // 精度处理：乘以100转为整数
  const precision = 100;
  const intTarget = Math.round(target * precision);
  const intCandidates = candidates.map(c => ({
    id: c.id,
    amount: Math.round(c.amount * precision)
  }));

  // 动态规划
  // dp[i] = 达到金额i时选中的receipt ID组合
  const dp: Map<number, string[] | null> = new Map();
  dp.set(0, []);

  for (const candidate of intCandidates) {
    const currentAmounts = Array.from(dp.keys());
    for (const currentAmount of currentAmounts) {
      const newAmount = currentAmount + candidate.amount;
      if (newAmount <= intTarget && !dp.has(newAmount)) {
        const prevSelection = dp.get(currentAmount);
        if (prevSelection !== undefined && prevSelection !== null) {
          dp.set(newAmount, [...prevSelection, candidate.id]);
        }
      }
    }
  }

  const result = dp.get(intTarget);
  return result || null;
}

// 计算ORDER BALANCE
// ORDER BALANCE = AMOUNT - 该ORDER下所有收据金额之和
export async function calculateOrderBalance(orderId: string, client: MatchingWriteClient = db): Promise<number> {
  const order = await client.order.findUnique({
    where: { id: orderId },
    include: { receipts: true }
  });

  if (!order) return 0;

  // 计算所有关联收据的金额总和
  const numericReceiptSum = order.receipts.reduce((sum, receipt) => sum + Number(receipt.usd), 0);

  // ORDER BALANCE = AMOUNT - 收据总额
  return Number(order.amount) - numericReceiptSum;
}

// 更新ORDER BALANCE
export async function updateOrderBalance(orderId: string, client: MatchingWriteClient = db): Promise<void> {
  const newBalance = await calculateOrderBalance(orderId, client);
  await client.order.update({
    where: { id: orderId },
    data: { orderBalance: newBalance }
  });
}

// 获取可用的RECEIPT列表（用于DETAIL匹配）
export async function getAvailableReceipts(): Promise<{
  id: string;
  usd: number;
  orderNo: string | null;
  status: ReceiptStatus;
  createdAt: Date;
}[]> {
  const receipts = await db.receipt.findMany({
    where: {
      status: ReceiptStatus.SR_Received
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      usd: true,
      orderNo: true,
      status: true,
      createdAt: true,
    }
  });

  return receipts.map((receipt) => ({
    ...receipt,
    usd: Number(receipt.usd),
  }));
}

// 查找匹配的RECEIPT
export async function findMatchingReceipt(
  orderNo: string | null,
  amount: number,
  options: FindMatchingReceiptOptions = {}
): Promise<string | null> {
  if (!orderNo) return null;
  const normalizedInput = normalizeOrderNo(orderNo);
  if (!normalizedInput) return null;

  const statuses = options.statuses && options.statuses.length > 0
    ? options.statuses
    : [ReceiptStatus.SR_Received];
  const requireAmountTolerance = options.requireAmountTolerance ?? true;
  const toleranceSetting = await db.systemSetting.findUnique({
    where: { key: 'DETAIL_RECEIPT_MATCH_TOLERANCE' },
    select: { value: true },
  });
  const tolerance = Number(toleranceSetting?.value ?? '5');
  const effectiveTolerance = Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : 5;

  // 严格创建规则要求金额在容差内；编辑规则可放宽金额，只按同一订单/别名组匹配后取金额最接近的收据。
  const minAmount = amount - effectiveTolerance;
  const maxAmount = amount + effectiveTolerance;
  const candidates = await db.receipt.findMany({
    where: {
      status: { in: statuses },
      ...(requireAmountTolerance ? { usd: { gte: minAmount, lte: maxAmount } } : {}),
      orderNo: { not: null },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      orderNo: true,
      createdAt: true,
      usd: true,
    },
  });

  const targetOrderId = await findOrderIdByNoOrAlias(orderNo);
  const orderNoMap = await mapOrderIdsByOrderNos(candidates.map((candidate) => candidate.orderNo));
  const matchedCandidates = candidates.filter((candidate) => {
    const candidateNormalized = normalizeOrderNo(candidate.orderNo);
    if (!candidateNormalized) return false;
    if (targetOrderId) {
      const candidateOrderId = orderNoMap.get(candidateNormalized) || null;
      return candidateOrderId === targetOrderId;
    }
    return candidateNormalized === normalizedInput;
  });
  if (matchedCandidates.length === 0) return null;

  // 同客组内优先金额最接近，若并列取最早创建
  matchedCandidates.sort((a, b) => {
    const diffA = Math.abs(Number(a.usd) - amount);
    const diffB = Math.abs(Number(b.usd) - amount);
    if (diffA !== diffB) return diffA - diffB;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  return matchedCandidates[0].id;
}

// 验证金额容差
// 允许±5的容差，超出需要标红但通过，超出±50则不给通过
export function validateAmountTolerance(
  detailTotal: number,
  swiftAmount: number,
  options: {
    warningTolerance?: number;
    rejectTolerance?: number;
  } = {}
): { valid: boolean; hasWarning: boolean; message: string } {
  const difference = Math.abs(detailTotal - swiftAmount);
  const warningTolerance = options.warningTolerance ?? 5;
  const rejectTolerance = options.rejectTolerance ?? 50;

  if (difference > rejectTolerance) {
    return {
      valid: false,
      hasWarning: true,
      message: `金额差异 ${difference.toFixed(2)} 超过允许范围(±${rejectTolerance})，无法通过验证`
    };
  }

  if (difference > warningTolerance) {
    return {
      valid: true,
      hasWarning: true,
      message: `金额差异 ${difference.toFixed(2)} 超出正常容差(±${warningTolerance})，已标红但允许通过`
    };
  }

  return {
    valid: true,
    hasWarning: false,
    message: '金额验证通过'
  };
}
