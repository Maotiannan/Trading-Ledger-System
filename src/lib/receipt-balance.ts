type ReceiptBalanceRow = {
  id: string;
  orderId: string | null;
  usd: number;
  createdAt: Date | string;
};

export function buildReceiptBalanceAfterMap(
  receipts: ReceiptBalanceRow[],
  orderAmounts: Map<string, number>,
): Map<string, number | null> {
  const byOrder = new Map<string, ReceiptBalanceRow[]>();
  for (const row of receipts) {
    if (!row.orderId) continue;
    if (!byOrder.has(row.orderId)) byOrder.set(row.orderId, []);
    byOrder.get(row.orderId)!.push(row);
  }

  const result = new Map<string, number | null>();
  for (const [orderId, rows] of byOrder.entries()) {
    const orderAmount = orderAmounts.get(orderId);
    if (!Number.isFinite(orderAmount)) {
      for (const row of rows) result.set(row.id, null);
      continue;
    }

    rows.sort((left, right) => {
      const leftTime = new Date(left.createdAt).getTime();
      const rightTime = new Date(right.createdAt).getTime();
      if (leftTime !== rightTime) return leftTime - rightTime;
      return left.id.localeCompare(right.id);
    });

    let remaining = Number(orderAmount);
    for (const row of rows) {
      remaining -= Number(row.usd);
      result.set(row.id, remaining);
    }
  }

  for (const row of receipts) {
    if (!result.has(row.id)) result.set(row.id, null);
  }
  return result;
}
