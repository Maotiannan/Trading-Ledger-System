import { db } from '@/lib/db';
import { ReceiptStatus } from '@prisma/client';
import { calculateOrderSimilarity, parseOrderTokens, serializeOrderTokens } from '@/lib/tokenizer';
import { deriveOrderGroupKey } from '@/lib/order-group';

// 确保DEPOSIT_POOL发票池存在
export async function ensureDepositPoolInvoice(userId: string): Promise<string> {
  // 查找或创建DEPOSIT_POOL发票
  let invoice = await db.invoice.findFirst({
    where: { invNo: 'DEPOSIT_POOL' }
  });

  if (!invoice) {
    invoice = await db.invoice.create({
      data: {
        invNo: 'DEPOSIT_POOL',
        createdBy: userId
      }
    });
  }

  return invoice.id;
}

// 确保Un_Associated发票池存在（用于自动创建的订单）
export async function ensureSystemPoolInvoice(userId: string): Promise<string> {
  // 查找或创建Un_Associated发票
  let invoice = await db.invoice.findFirst({
    where: { invNo: 'Un_Associated' }
  });

  if (!invoice) {
    invoice = await db.invoice.create({
      data: {
        invNo: 'Un_Associated',
        createdBy: userId
      }
    });
  }

  return invoice.id;
}

// 创建新的Order
export async function createOrder(orderNo: string, userId: string): Promise<string> {
  const invoiceId = await ensureSystemPoolInvoice(userId);

  try {
    const order = await db.order.create({
      data: {
        invoiceId,
        orderNo,
        tokens: serializeOrderTokens(orderNo),
        amount: 0, // 初始金额为0，会随着收据累加
        orderBalance: 0,
        needsCustomerFix: true,
      }
    });

    return order.id;
  } catch (error: unknown) {
    const prismaError = error as { code?: string };
    if (prismaError.code !== 'P2002') {
      throw error;
    }

    const existing = await db.order.findFirst({
      where: { invoiceId, orderNo },
      select: { id: true }
    });
    if (existing) {
      return existing.id;
    }
    throw error;
  }
}

// 查找或创建Order
export async function findOrCreateOrder(orderNo: string, userId: string): Promise<string> {
  const normalizedOrderNo = orderNo.toLowerCase().trim();
  if (!normalizedOrderNo) {
    return createOrder(orderNo, userId);
  }

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
  return createOrder(orderNo, userId);
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
  const normalizedOrderNo = orderNo.toLowerCase().trim();
  if (!normalizedOrderNo) return null;

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
      amount: exact.amount,
      orderBalance: exact.orderBalance,
    };
  }

  // 再做“拆分元素去掉最右序号”匹配
  const inputKey = deriveOrderGroupKey(orderNo);
  if (inputKey) {
    const grouped = orders.find((order) => deriveOrderGroupKey(order.orderNo) === inputKey);
    if (grouped) {
      return {
        orderId: grouped.id,
        orderNo: grouped.orderNo,
        amount: grouped.amount,
        orderBalance: grouped.orderBalance,
      };
    }
  }

  let bestMatch: {
    id: string;
    orderNo: string;
    amount: number;
    orderBalance: number;
    score: number;
  } | null = null;

  for (const order of orders) {
    const score = calculateOrderSimilarity(orderNo, order.orderNo, parseOrderTokens(order.tokens));
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        id: order.id,
        orderNo: order.orderNo,
        amount: order.amount,
        orderBalance: order.orderBalance,
        score,
      };
    }
  }

  if (bestMatch && bestMatch.score >= 0.58) {
    return {
      orderId: bestMatch.id,
      orderNo: bestMatch.orderNo,
      amount: bestMatch.amount,
      orderBalance: bestMatch.orderBalance,
    };
  }

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
export async function calculateOrderBalance(orderId: string): Promise<number> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { receipts: true }
  });

  if (!order) return 0;

  // 计算所有关联收据的金额总和
  const receiptSum = order.receipts.reduce((sum, receipt) => sum + receipt.usd, 0);

  // ORDER BALANCE = AMOUNT - 收据总额
  return order.amount - receiptSum;
}

// 更新ORDER BALANCE
export async function updateOrderBalance(orderId: string): Promise<void> {
  const newBalance = await calculateOrderBalance(orderId);
  await db.order.update({
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

  return receipts;
}

// 查找匹配的RECEIPT
export async function findMatchingReceipt(
  orderNo: string | null,
  amount: number
): Promise<string | null> {
  if (!orderNo) return null;

  const normalizedOrderNo = orderNo.toLowerCase().trim();
  if (!normalizedOrderNo) return null;

  const selectFields = {
    id: true,
    orderNo: true,
    createdAt: true,
  } as const;

  const chooseBest = (
    candidates: Array<{ id: string; orderNo: string | null }>,
    threshold: number
  ): string | null => {
    let best: { id: string; score: number } | null = null;
    for (const candidate of candidates) {
      if (!candidate.orderNo) continue;
      const score = calculateOrderSimilarity(normalizedOrderNo, candidate.orderNo);
      if (!best || score > best.score) {
        best = { id: candidate.id, score };
      }
    }
    if (best && best.score >= threshold) {
      return best.id;
    }
    return null;
  };

  // 先尝试精确匹配：ORDER和金额都匹配
  const allReceipts = await db.receipt.findMany({
    where: {
      usd: amount,
      status: ReceiptStatus.SR_Received
    },
    orderBy: { createdAt: 'asc' },
    select: selectFields
  });

  const exactMatch = chooseBest(allReceipts, 0.6);

  if (exactMatch) return exactMatch;

  // 如果没有精确匹配，尝试只匹配ORDER
  const allMatchingReceipts = await db.receipt.findMany({
    where: {
      status: ReceiptStatus.SR_Received
    },
    orderBy: { createdAt: 'asc' },
    select: selectFields
  });

  const orderMatch = chooseBest(allMatchingReceipts, 0.72);

  return orderMatch || null;
}

// 验证金额容差
// 允许±5的容差，超出需要标红但通过，超出±50则不给通过
export function validateAmountTolerance(
  detailTotal: number,
  swiftAmount: number
): { valid: boolean; hasWarning: boolean; message: string } {
  const difference = Math.abs(detailTotal - swiftAmount);

  if (difference > 50) {
    return {
      valid: false,
      hasWarning: true,
      message: `金额差异 ${difference.toFixed(2)} 超过允许范围(±50)，无法通过验证`
    };
  }

  if (difference > 5) {
    return {
      valid: true,
      hasWarning: true,
      message: `金额差异 ${difference.toFixed(2)} 超出正常容差(±5)，已标红但允许通过`
    };
  }

  return {
    valid: true,
    hasWarning: false,
    message: '金额验证通过'
  };
}
