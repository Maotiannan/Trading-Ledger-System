import type { DbTransactionClient } from '@/lib/transaction';
import { createApiError } from '@/lib/api-error';
import { getCustomerPayerBase } from '@/lib/customer-display';

function identityConflict() {
  return createApiError({ code: 'CONFLICT', status: 409,
    message: 'The customer must match the stable MuCont invoice group. Check the selected order/customer before saving.' });
}

// Call after locking the target order. Display text is never an identity key for
// receipts belonging to an imported invoice group.
export async function sourceReceiptCustomer(tx: DbTransactionClient, orderId: string | null, explicitCustomerId?: string | null) {
  if (!orderId) return null;
  const group = await tx.mucontInvoiceGroup.findUnique({ where: { orderId }, include: { order: { include: { customer: true } } } });
  if (!group) return null;
  const order = group.order;
  if (order.canceledAt) throw createApiError({ code: 'CONFLICT', status: 409, message: 'This invoice group was canceled. Select an active order.' });
  if (order.customerId !== group.customerId || !order.customer || (explicitCustomerId && explicitCustomerId !== group.customerId)) {
    throw identityConflict();
  }
  return {
    customerId: group.customerId,
    customerMark: order.customer.mark,
    customerName: order.customerName || order.customer.orderName,
    customerPayerName: getCustomerPayerBase(order.customer),
    customerPhone: order.customerPhone,
    customerCity: order.customerCity,
    needsCustomerFix: false,
  };
}

type WriteData = Record<string, unknown>;
function hasIdentity(data: WriteData, name: 'customer' | 'order') {
  return Object.hasOwn(data, `${name}Id`) || Object.hasOwn(data, name);
}
function nextIdentity(data: WriteData, name: 'customer' | 'order', previous: string | null) {
  if (Object.hasOwn(data, `${name}Id`)) {
    const value = data[`${name}Id`];
    return value && typeof value === 'object' ? (value as { set: string | null }).set : value as string | null;
  }
  const relation = data[name] as { connect?: { id?: string }; disconnect?: boolean } | undefined;
  if (relation?.disconnect) return null;
  return relation?.connect?.id ?? previous;
}

// Defense at the existing financial transaction boundary. Covers fix-customer,
// bulk updates and derived receipt writers as well as normal UI paths.
export async function guardSourceCustomerWrites(tx: DbTransactionClient, model: 'order' | 'receipt',
  method: string, args: Record<string, unknown>, ids: string[]) {
  const dataRows = (Array.isArray(args.data) ? args.data : [args.data, args.create, args.update].filter(Boolean)) as WriteData[];
  if (!dataRows.some((data) => hasIdentity(data, 'customer') || (model === 'receipt' && hasIdentity(data, 'order')))) return;
  if (model === 'order') {
    if (!ids.length) return;
    const groups = await tx.mucontInvoiceGroup.findMany({ where: { orderId: { in: ids } }, select: { customerId: true } });
    for (const data of dataRows) for (const group of groups) {
      if (nextIdentity(data, 'customer', group.customerId) !== group.customerId) throw identityConflict();
    }
    return;
  }
  const rows = ids.length ? await tx.receipt.findMany({ where: { id: { in: ids } }, select: { orderId: true, customerId: true } }) : [];
  const candidates: Array<{ orderId: string | null; customerId: string | null }> = [];
  const updates = method === 'upsert' ? [rows.length ? args.update : args.create] as WriteData[] : dataRows;
  for (const data of updates) {
    for (const row of rows.length ? rows : [{ orderId: null, customerId: null }]) {
      candidates.push({ orderId: nextIdentity(data, 'order', row.orderId), customerId: nextIdentity(data, 'customer', row.customerId) });
    }
  }
  const orderIds = [...new Set(candidates.flatMap((row) => row.orderId ? [row.orderId] : []))];
  if (!orderIds.length) return;
  const groups = await tx.mucontInvoiceGroup.findMany({ where: { orderId: { in: orderIds } }, select: { orderId: true, customerId: true } });
  const identities = new Map(groups.map((row) => [row.orderId, row.customerId]));
  for (const row of candidates) {
    const expected = row.orderId ? identities.get(row.orderId) : undefined;
    if (expected && row.customerId !== expected) throw identityConflict();
  }
}
