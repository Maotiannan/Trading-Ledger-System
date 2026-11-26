import { Prisma } from '@prisma/client';
import { createApiError } from '@/lib/api-error';
import type { DbTransactionClient } from '@/lib/transaction';
import { guardSourceCustomerWrites } from '@/lib/integrations/mucont-invoice-customer';
import { guardPrepaymentWrites, allocateNewReceipt, guardPrepaymentCustomerRemoval } from '@/lib/prepayments/write-guards';

export async function lockOrderBalances(tx: DbTransactionClient, ids: Array<string | null | undefined>) {
  for (const id of [...new Set(ids.filter((value): value is string => Boolean(value)))].sort()) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM \`Order\` WHERE id = ${id} FOR UPDATE`);
  }
}

export async function lockOrderSnapshots(tx: DbTransactionClient, snapshots: Array<{ id: string; updatedAt: Date }>, extraOrderIds: string[] = []) {
  await lockOrderBalances(tx, [...snapshots.map((row) => row.id), ...extraOrderIds]);
  const rows = await tx.order.findMany({ where: { id: { in: snapshots.map((row) => row.id) } }, select: { id: true, updatedAt: true } });
  const expected = new Map(snapshots.map((row) => [row.id, row.updatedAt.getTime()]));
  if (rows.length !== expected.size || rows.some((row) => expected.get(row.id) !== row.updatedAt.getTime())) {
    throw createApiError({ code: 'CONFLICT', status: 409, message: '订单已变化，请刷新后重试' });
  }
}

export async function lockReceiptBalances(tx: DbTransactionClient, receiptIds: string[], extraOrderIds: string[] = []) {
  const ids = [...new Set(receiptIds)].sort();
  const before = await tx.receipt.findMany({ where: { id: { in: ids } }, select: { id: true, orderId: true } });
  await lockOrderBalances(tx, [...before.map((row) => row.orderId), ...extraOrderIds]);
  for (const id of ids) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM Receipt WHERE id = ${id} FOR UPDATE`);
  }
  const after = await tx.receipt.findMany({ where: { id: { in: ids } }, select: { id: true, orderId: true } });
  if (JSON.stringify(before.sort((a, b) => a.id.localeCompare(b.id))) !== JSON.stringify(after.sort((a, b) => a.id.localeCompare(b.id)))) {
    throw createApiError({ code: 'CONFLICT', status: 409, message: '收据关联已变化，请刷新后重试' });
  }
}

// The financial transaction boundary protects writes added by imports and derived
// workflows as well as explicit UI actions. Read/decide paths still lock up front.
export function guardFinancialWrites(tx: DbTransactionClient): DbTransactionClient {
  const mutations = new Set(['create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert']);
  const guarded = new Proxy(tx, {
    get(target, name) {
      const delegate = Reflect.get(target, name);
      if (name !== 'receipt' && name !== 'order' && name !== 'customer') return typeof delegate === 'function' ? delegate.bind(target) : delegate;
      return new Proxy(delegate, {
        get(model, method) {
          const operation = Reflect.get(model, method);
          if (typeof method !== 'string' || !mutations.has(method)) return typeof operation === 'function' ? operation.bind(model) : operation;
          return async (args: Record<string, unknown>) => {
            const where = args.where as Prisma.ReceiptWhereInput & Prisma.OrderWhereInput | undefined;
            const data = (Array.isArray(args.data) ? args.data : [args.data, args.create, args.update].filter(Boolean)) as Array<Record<string, unknown>>;
            const selection = where || (method === 'deleteMany' || method === 'updateMany' ? {} : undefined);
            let receiptIds: string[] = [];
            if (name === 'customer') {
              if (method.startsWith('delete')) {
                const rows = await tx.customer.findMany({ where: args.where as Prisma.CustomerWhereInput | undefined, select: { id: true } });
                await guardPrepaymentCustomerRemoval(guarded, rows.map(row => row.id));
              }
            } else if (name === 'order') {
              const rows = selection ? await tx.order.findMany({ where: selection, select: { id: true } }) : [];
              await lockOrderBalances(tx, rows.map((row) => row.id));
              await guardSourceCustomerWrites(tx, 'order', method, args, rows.map((row) => row.id));
              await guardPrepaymentWrites(guarded, 'order', method, args, rows.map((row) => row.id));
            } else {
              const rows = selection ? await tx.receipt.findMany({ where: selection, select: { id: true } }) : [];
              receiptIds = rows.map(row => row.id);
              const nextIds = data.flatMap((row) => {
                const relation = row.order as { connect?: Prisma.OrderWhereUniqueInput } | undefined;
                const scalar = row.orderId as string | { set?: string } | undefined;
                return [typeof scalar === 'string' ? scalar : scalar?.set, relation?.connect?.id];
              }).filter((id): id is string => Boolean(id));
              await lockReceiptBalances(tx, rows.map((row) => row.id), nextIds);
              await guardSourceCustomerWrites(tx, 'receipt', method, args, rows.map((row) => row.id));
              await guardPrepaymentWrites(guarded, 'receipt', method, args, rows.map((row) => row.id));
            }
            const result = await operation.call(model, args);
            if (name === 'receipt' && !method.startsWith('delete')) {
              if (result?.id) await allocateNewReceipt(guarded, result.id);
              else for (const id of receiptIds) await allocateNewReceipt(guarded, id);
            }
            return result;
          };
        },
      });
    },
  });
  return guarded;
}
