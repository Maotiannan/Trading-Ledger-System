import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import type { CurrentUser } from '@/lib/request-auth';
import { buildOrderVisibilityWhere, buildReceiptVisibilityWhere } from '@/lib/resource-visibility';
import { computeOrderBalanceFromReceipts } from '@/lib/order-balance';
import { listPrepaymentCredits } from './transfers';
import type { DepositPool, DepositPoolRow } from './pool-types';

const sum = (values: (Prisma.Decimal | string)[]) => values.reduce<Prisma.Decimal>((a, b) => a.plus(b), new Prisma.Decimal(0));

export async function loadDepositPool(user: CurrentUser, ownerIds: string[]): Promise<DepositPool> {
  const credits = await listPrepaymentCredits(user, ownerIds);
  const legacy = await db.order.findMany({ where: { AND: [buildOrderVisibilityWhere(ownerIds),
    { invoice: { invNo: 'DEPOSIT_POOL' } }],
  }, select: { id: true, orderNo: true, amount: true, customerMark: true, customer: { select: { mark: true } },
    receipts: { where: { AND: [buildReceiptVisibilityWhere(ownerIds), { funding: null }] },
      select: { id: true, usd: true, status: true } } } });
  const pending = new Set((await db.deletionRequest.findMany({ where: { targetType: 'RECEIPT', status: 'PENDING',
    targetId: { in: legacy.flatMap(o => o.receipts.map(r => r.id)) },
  }, select: { targetId: true } })).map(r => r.targetId));
  const rows: DepositPoolRow[] = credits.credits.map(c => ({ id: `credit:${c.creditId}`, kind: 'CREDIT',
    creditId: c.creditId, orderId: c.sourceOrderId || (!c.transferred ? c.originalOrderId : null), orderNo: c.sourceOrderNo, customerLabel: c.customerLabel,
    receiptNo: c.receiptNo, availableAmount: c.availableAmount, usedAmount: c.usedAmount, reservedAmount: c.reservedAmount,
    held: c.held, heldAmount: c.held ? new Prisma.Decimal(c.amount).minus(c.usedAmount).minus(c.reservedAmount).toFixed(2) : '0.00',
    pendingSignature: false, active: c.active, legacyBalance: null }));
  for (const order of legacy) {
    if (!order.receipts.length) continue;
    const balance = computeOrderBalanceFromReceipts({ amount: order.amount, receipts: order.receipts });
    const remaining = Prisma.Decimal.max(0, -balance);
    const blocked = sum(order.receipts.filter(r => pending.has(r.id) && r.status !== 'SIGNING_PENDING').map(r => r.usd));
    const held = Prisma.Decimal.min(remaining, blocked);
    rows.push({ id: `legacy:${order.id}`, kind: 'LEGACY', orderId: order.id, orderNo: order.orderNo,
      customerLabel: (order.customer ? order.customer.mark : order.customerMark) || '-', creditId: null, receiptNo: null,
      availableAmount: remaining.minus(held).toFixed(2), usedAmount: Prisma.Decimal.max(0, order.amount).toFixed(2),
      reservedAmount: '0.00', held: held.gt(0), heldAmount: held.toFixed(2),
      pendingSignature: order.receipts.some(r => r.status === 'SIGNING_PENDING'), active: true, legacyBalance: balance });
  }
  return { rows, availableTotal: sum(rows.map(r => r.availableAmount)).toFixed(2),
    reservedTotal: sum(rows.map(r => r.reservedAmount)).toFixed(2), heldTotal: sum(rows.map(r => r.heldAmount)).toFixed(2) };
}
