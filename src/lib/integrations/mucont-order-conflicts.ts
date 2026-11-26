import { z } from 'zod';
import { db } from '@/lib/db';
import type { DbTransactionClient } from '@/lib/transaction';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { buildOrderVisibilityWhere } from '@/lib/resource-visibility';
import { normalizeOrderNo, splitCompositeOrderNo } from '@/lib/order-alias';
import { SYSTEM_POOL_INVOICE_NOS } from '@/lib/payment-type-classifier';
import { MucontInvoiceError } from './mucont-invoice-contract';

const text = z.string().trim().min(1).max(191);
export const orderConflictsSchema = z.object({
  invoiceBatchId: text,
  items: z.array(z.object({ key: text, displayOrderNo: text, sourceOrderNo: text.optional() })).max(500),
}).refine(value => new Set(value.items.map(row => row.key)).size === value.items.length, 'Item keys must be unique.');

type ConflictOrder = { id: string; orderNo: string; aliases: { aliasNo: string }[]; invoice: { id: string; invNo: string } };
const tokens = (value: string) => [...new Set([value, ...splitCompositeOrderNo(value)].map(normalizeOrderNo).filter(Boolean))];

export function matchFormalOrders(items: z.infer<typeof orderConflictsSchema>['items'], orders: ConflictOrder[]) {
  const indexed = orders.map(order => ({ order, names: new Set([
    ...tokens(order.orderNo), ...order.aliases.flatMap(alias => tokens(alias.aliasNo)),
  ]) }));
  return items.map(item => ({ key: item.key, matches: indexed.flatMap(({ order, names }) => {
    const display = tokens(item.displayOrderNo).find(token => names.has(token));
    const source = item.sourceOrderNo ? tokens(item.sourceOrderNo).find(token => names.has(token)) : undefined;
    if (!display && !source) return [];
    return [{ kind: display ? 'DISPLAY' as const : 'SOURCE_HINT' as const, invoiceId: order.invoice.id,
      invNo: order.invoice.invNo, orderId: order.id, orderNo: order.orderNo,
      matchedOrderNo: display || source! }];
  }) }));
}

export async function listMucontOrderConflicts(input: unknown, tx: DbTransactionClient = db) {
  const parsed = orderConflictsSchema.safeParse(input);
  if (!parsed.success) throw new MucontInvoiceError(422, 'ORDER_CONFLICTS_INVALID_PAYLOAD', 'Invalid batch or order conflict query (maximum 500 unique items).');
  const actorId = process.env.MUCONT_INVOICE_ACTOR_ID;
  const actor = actorId ? await tx.user.findFirst({ where: { id: actorId, role: 'ADMIN', disabledAt: null } }) : null;
  if (!actor) throw new MucontInvoiceError(503, 'SERVICE_ACTOR_UNAVAILABLE', 'An active invoice integration administrator must be configured.');
  if (!parsed.data.items.length) return { items: [] };
  const scope = await getHierarchyScope(actor, tx);
  const orders = await tx.order.findMany({
    where: { ...buildOrderVisibilityWhere([...scope.ownerVisibleIds]), invoice: {
      invNo: { notIn: [...SYSTEM_POOL_INVOICE_NOS] },
      OR: [{ mucontSource: null }, { mucontSource: { invoiceBatchId: { not: parsed.data.invoiceBatchId } } }],
    } },
    select: { id: true, orderNo: true, aliases: { select: { aliasNo: true } }, invoice: { select: { id: true, invNo: true } } },
    orderBy: [{ invoiceId: 'asc' }, { orderNo: 'asc' }, { id: 'asc' }],
  });
  return { items: matchFormalOrders(parsed.data.items, orders) };
}
