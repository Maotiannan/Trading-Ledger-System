import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { serializeOrderTokens } from '@/lib/tokenizer';
import { deriveOrderGroupKey } from '@/lib/order-group';
import { buildOrderNoWithAliases, canonicalizeOrderNo, isCompositeOrderNo, normalizeOrderNo, splitCompositeOrderNo } from '@/lib/order-alias';
import { buildCompositeOrderLookupCandidates } from '@/lib/order-name-kernel';

type DbExecutor = Prisma.TransactionClient | typeof db;

async function findFirstOrderMatch(
  executor: DbExecutor,
  args: NonNullable<Parameters<typeof db.order.findFirst>[0]>
): Promise<{ id: string } | null> {
  const orderDelegate = (executor as DbExecutor & {
    order?: {
      findFirst?: typeof db.order.findFirst;
      findMany?: typeof db.order.findMany;
    };
  }).order;

  if (orderDelegate?.findFirst) {
    return orderDelegate.findFirst(args);
  }

  if (orderDelegate?.findMany) {
    const rows = await orderDelegate.findMany({
      where: args.where,
      select: args.select,
      take: 1,
    } as Parameters<typeof db.order.findMany>[0]);
    return rows[0] ?? null;
  }

  return null;
}

export async function findOrderIdByNoOrAliasWithExecutor(
  executor: DbExecutor,
  orderNo: string | null | undefined,
  orderWhere?: Prisma.OrderWhereInput
): Promise<string | null> {
  const raw = (orderNo || '').trim();
  if (!raw) return null;
  const candidates = buildCompositeOrderLookupCandidates(raw);

  const aliasDelegate = (executor as DbExecutor & { orderAlias?: { findFirst?: typeof db.orderAlias.findFirst; findMany?: typeof db.orderAlias.findMany } }).orderAlias;

  const aliasMatch = candidates.normalizedOrderNos.length > 0 && aliasDelegate?.findFirst
    ? await aliasDelegate.findFirst({
        where: {
          aliasNo: candidates.normalizedOrderNos.length === 1
            ? candidates.normalizedOrderNos[0]
            : { in: candidates.normalizedOrderNos },
          ...(orderWhere ? { order: orderWhere } : {}),
        },
        select: { orderId: true },
      })
    : null;
  if (aliasMatch) return aliasMatch.orderId;

  const orderMatch = candidates.exactOrderNos.length > 0
    ? await findFirstOrderMatch(executor, {
        where: {
          AND: [
            ...(orderWhere ? [orderWhere] : []),
            {
              orderNo: candidates.exactOrderNos.length === 1
                ? { equals: candidates.exactOrderNos[0] }
                : { in: candidates.exactOrderNos },
            },
          ],
        },
        select: { id: true },
      })
    : null;
  if (orderMatch?.id) return orderMatch.id;

  if (candidates.exactOrderNos.length === 0) return null;

  const compositeFallback = await executor.order.findMany({
    where: {
      AND: [
        ...(orderWhere ? [orderWhere] : []),
        {
          OR: candidates.exactOrderNos.map((row) => ({ orderNo: { contains: row } })),
        },
      ],
    },
    select: { id: true, orderNo: true },
  });

  for (const row of compositeFallback) {
    const rowSegments = splitCompositeOrderNo(row.orderNo).map((part) => normalizeOrderNo(part));
    if (rowSegments.some((segment) => candidates.normalizedOrderNos.includes(segment))) {
      return row.id;
    }
  }

  return null;
}

export async function findOrderIdByNoOrAlias(
  orderNo: string | null | undefined,
  orderWhere?: Prisma.OrderWhereInput
): Promise<string | null> {
  return findOrderIdByNoOrAliasWithExecutor(db, orderNo, orderWhere);
}

export async function mapOrderIdsByOrderNosWithExecutor(
  executor: DbExecutor,
  orderNos: Array<string | null | undefined>,
  orderWhere?: Prisma.OrderWhereInput
): Promise<Map<string, string>> {
  const normalizedOrderNos = Array.from(new Set(orderNos.map((value) => normalizeOrderNo(value)).filter(Boolean)));
  const mapped = new Map<string, string>();
  if (normalizedOrderNos.length === 0) return mapped;

  const aliasDelegate = (executor as DbExecutor & { orderAlias?: { findMany?: typeof db.orderAlias.findMany } }).orderAlias;
  if (aliasDelegate?.findMany) {
    const aliasRows = await aliasDelegate.findMany({
      where: {
        aliasNo: { in: normalizedOrderNos },
        ...(orderWhere ? { order: orderWhere } : {}),
      },
      select: { aliasNo: true, orderId: true },
    });
    for (const row of aliasRows) {
      mapped.set(row.aliasNo, row.orderId);
    }
  }

  const unresolved = normalizedOrderNos.filter((row) => !mapped.has(row));
  if (unresolved.length === 0) return mapped;

  const orderRows = await executor.order.findMany({
    where: {
      AND: [
        ...(orderWhere ? [orderWhere] : []),
        {
          orderNo: { in: unresolved },
        },
      ],
    },
    select: { id: true, orderNo: true },
  });
  for (const row of orderRows) {
    const key = normalizeOrderNo(row.orderNo);
    if (!mapped.has(key)) mapped.set(key, row.id);
  }

  return mapped;
}

export async function mapOrderIdsByOrderNos(
  orderNos: Array<string | null | undefined>,
  orderWhere?: Prisma.OrderWhereInput
): Promise<Map<string, string>> {
  return mapOrderIdsByOrderNosWithExecutor(db, orderNos, orderWhere);
}

export async function syncOrderAliases(tx: DbExecutor, orderId: string, orderNo: string): Promise<number> {
  const aliasNos = buildOrderNoWithAliases(orderNo).aliasNos;
  return syncOrderAliasesByAliasNos(tx, orderId, aliasNos);
}

export async function syncOrderAliasesByAliasNos(tx: DbExecutor, orderId: string, aliasNos: string[]): Promise<number> {
  await tx.orderAlias.deleteMany({ where: { orderId } });
  const normalized = Array.from(new Set(aliasNos.map((value) => normalizeOrderNo(value)).filter(Boolean)));
  if (normalized.length === 0) return 0;
  const created = await tx.orderAlias.createMany({
    data: normalized.map((aliasNo) => ({ orderId, aliasNo })),
    skipDuplicates: true,
  });
  return created.count;
}

async function refreshOrderBalance(tx: DbExecutor, orderId: string): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { receipts: { select: { usd: true } } },
  });
  if (!order) return;
  const receiptSum = order.receipts.reduce((sum, row) => sum + Number(row.usd), 0);
  await tx.order.update({
    where: { id: orderId },
    data: { orderBalance: Number(order.amount) - receiptSum },
  });
}

export async function consolidateGroupedOrders(params?: {
  orderWhere?: Prisma.OrderWhereInput;
  invoiceIds?: string[];
  skipSystemPool?: boolean;
}): Promise<{ mergedGroups: number; mergedOrders: number; createdGroups: number; syncedAliases: number }> {
  const { orderWhere, invoiceIds, skipSystemPool = true } = params || {};

  const baseWhere: Prisma.OrderWhereInput = {
    AND: [
      ...(orderWhere ? [orderWhere] : []),
      ...(invoiceIds && invoiceIds.length > 0 ? [{ invoiceId: { in: invoiceIds } }] : []),
      ...(skipSystemPool
        ? [{ invoice: { invNo: { notIn: ['Un_Associated', 'DEPOSIT_POOL'] } } }]
        : []),
    ],
  };

  const orders = await db.order.findMany({
    where: baseWhere,
    include: {
      invoice: { select: { id: true, createdBy: true } },
    },
    orderBy: [{ invoiceId: 'asc' }, { createdAt: 'asc' }],
  });

  if (orders.length === 0) {
    return { mergedGroups: 0, mergedOrders: 0, createdGroups: 0, syncedAliases: 0 };
  }

  const orderIds = orders.map((row) => row.id);
  const aliasRows = await db.orderAlias.findMany({
    where: { orderId: { in: orderIds } },
    select: { orderId: true, aliasNo: true },
  });
  const aliasMap = new Map<string, string[]>();
  for (const row of aliasRows) {
    if (!aliasMap.has(row.orderId)) aliasMap.set(row.orderId, []);
    aliasMap.get(row.orderId)!.push(row.aliasNo);
  }

  const bucket = new Map<string, typeof orders>();
  for (const row of orders) {
    const groupKey = deriveOrderGroupKey(row.orderNo);
    if (!groupKey) continue;
    const key = `${row.invoiceId}::${groupKey}`;
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key)!.push(row);
  }

  let mergedGroups = 0;
  let mergedOrders = 0;
  let createdGroups = 0;
  let syncedAliases = 0;

  for (const rows of bucket.values()) {
    const distinctOrderNos = new Set(rows.map((row) => normalizeOrderNo(row.orderNo)));
    if (distinctOrderNos.size <= 1) continue;

    const allParts = Array.from(
      new Set(
        rows.flatMap((row) => {
          if (isCompositeOrderNo(row.orderNo)) {
            return splitCompositeOrderNo(row.orderNo).map((part) => normalizeOrderNo(part));
          }
          return [normalizeOrderNo(row.orderNo)];
        }).filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));

    if (allParts.length <= 1) continue;

    const canonicalOrderNo = allParts.join('/');
    const preferred = rows.find((row) => row.customerId && !row.needsCustomerFix) || rows[0];
    const existingComposite = rows.find((row) => isCompositeOrderNo(row.orderNo));

    await db.$transaction(async (tx) => {
      let targetId: string;
      if (existingComposite) {
        targetId = existingComposite.id;
        if (normalizeOrderNo(existingComposite.orderNo) !== normalizeOrderNo(canonicalOrderNo)) {
          await tx.order.update({
            where: { id: existingComposite.id },
            data: {
              orderNo: canonicalOrderNo,
              tokens: serializeOrderTokens(canonicalOrderNo),
            },
          });
        }
      } else {
        const created = await tx.order.create({
          data: {
            invoiceId: preferred.invoiceId,
            orderNo: canonicalOrderNo,
            tokens: serializeOrderTokens(canonicalOrderNo),
            amount: rows.reduce((sum, row) => sum + Number(row.amount), 0),
            orderBalance: 0,
            createdBy: preferred.createdBy || preferred.invoice.createdBy,
            customerId: preferred.customerId,
            customerMark: preferred.customerMark,
            customerName: preferred.customerName,
            customerPhone: preferred.customerPhone,
            customerCity: preferred.customerCity,
            needsCustomerFix: preferred.needsCustomerFix,
          },
          select: { id: true },
        });
        targetId = created.id;
      }

      const sources = rows.filter((row) => row.id !== targetId);
      if (sources.length > 0) {
        const incrementAmount = existingComposite
          ? sources.reduce((sum, row) => sum + Number(row.amount), 0)
          : 0;

        if (incrementAmount !== 0) {
          await tx.order.update({
            where: { id: targetId },
            data: { amount: { increment: incrementAmount } },
          });
        }

        for (const source of sources) {
          await tx.receipt.updateMany({
            where: { orderId: source.id },
            data: { orderId: targetId },
          });
          await tx.order.delete({ where: { id: source.id } });
          mergedOrders += 1;
        }
      }

      const inheritedAliases = Array.from(
        new Set(
          rows
            .flatMap((row) => {
              const rowAliases = aliasMap.get(row.id) || [];
              if (rowAliases.length > 0) return rowAliases;
              if (isCompositeOrderNo(row.orderNo)) {
                return splitCompositeOrderNo(row.orderNo).map((part) => normalizeOrderNo(part));
              }
              return [normalizeOrderNo(row.orderNo)];
            })
            .filter(Boolean)
        )
      );

      syncedAliases += await syncOrderAliasesByAliasNos(tx, targetId, inheritedAliases);
      await refreshOrderBalance(tx, targetId);
    });

    mergedGroups += 1;
    if (!existingComposite) {
      createdGroups += 1;
    }
  }

  return { mergedGroups, mergedOrders, createdGroups, syncedAliases };
}
