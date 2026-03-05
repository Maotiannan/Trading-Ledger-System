import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

function normalizeOrderNo(value) {
  return String(value || '').trim().toLowerCase();
}

function deriveOrderGroupKey(orderNo) {
  const tokens = String(orderNo || '')
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length <= 1) return tokens.join('-');
  return tokens.slice(0, -1).join('-');
}

function splitCompositeOrderNo(orderNo) {
  return String(orderNo || '')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
}

function isCompositeOrderNo(orderNo) {
  return splitCompositeOrderNo(orderNo).length > 1;
}

function buildCanonicalGroupOrderNo(orderNos) {
  return Array.from(
    new Set(
      orderNos
        .flatMap((orderNo) => {
          if (isCompositeOrderNo(orderNo)) {
            return splitCompositeOrderNo(orderNo).map((part) => normalizeOrderNo(part));
          }
          return [normalizeOrderNo(orderNo)];
        })
        .filter(Boolean)
    )
  )
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }))
    .join('/');
}

async function refreshOrderBalance(tx, orderId) {
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

async function run() {
  const orders = await db.order.findMany({
    where: {
      invoice: {
        invNo: { notIn: ['Un_Associated', 'DEPOSIT_POOL'] },
      },
    },
    include: {
      invoice: { select: { id: true, createdBy: true } },
    },
    orderBy: [{ invoiceId: 'asc' }, { createdAt: 'asc' }],
  });

  const bucket = new Map();
  for (const row of orders) {
    const groupKey = deriveOrderGroupKey(row.orderNo);
    if (!groupKey) continue;
    const key = `${row.invoiceId}::${groupKey}`;
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key).push(row);
  }

  let mergedGroups = 0;
  let mergedOrders = 0;
  let createdGroups = 0;

  for (const rows of bucket.values()) {
    const distinct = new Set(rows.map((row) => normalizeOrderNo(row.orderNo)));
    if (distinct.size <= 1) continue;

    const canonicalOrderNo = buildCanonicalGroupOrderNo(rows.map((row) => row.orderNo));
    if (!canonicalOrderNo || splitCompositeOrderNo(canonicalOrderNo).length <= 1) continue;

    const preferred = rows.find((row) => row.customerId && !row.needsCustomerFix) || rows[0];
    const existingComposite = rows.find((row) => isCompositeOrderNo(row.orderNo));

    await db.$transaction(async (tx) => {
      let targetId;

      if (existingComposite) {
        targetId = existingComposite.id;
        if (normalizeOrderNo(existingComposite.orderNo) !== normalizeOrderNo(canonicalOrderNo)) {
          await tx.order.update({
            where: { id: existingComposite.id },
            data: {
              orderNo: canonicalOrderNo,
              tokens: JSON.stringify(splitCompositeOrderNo(canonicalOrderNo).map((token) => token.toLowerCase())),
            },
          });
        }
      } else {
        const created = await tx.order.create({
          data: {
            invoiceId: preferred.invoiceId,
            orderNo: canonicalOrderNo,
            tokens: JSON.stringify(splitCompositeOrderNo(canonicalOrderNo).map((token) => token.toLowerCase())),
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
        createdGroups += 1;
      }

      const aliasNos = Array.from(
        new Set(
          rows
            .flatMap((row) => {
              if (isCompositeOrderNo(row.orderNo)) {
                return splitCompositeOrderNo(row.orderNo).map((part) => normalizeOrderNo(part));
              }
              return [normalizeOrderNo(row.orderNo)];
            })
            .filter(Boolean)
        )
      );

      const sourceRows = rows.filter((row) => row.id !== targetId);
      if (sourceRows.length > 0) {
        if (existingComposite) {
          const incrementAmount = sourceRows.reduce((sum, row) => sum + Number(row.amount), 0);
          if (incrementAmount !== 0) {
            await tx.order.update({
              where: { id: targetId },
              data: { amount: { increment: incrementAmount } },
            });
          }
        }

        for (const source of sourceRows) {
          await tx.receipt.updateMany({
            where: { orderId: source.id },
            data: { orderId: targetId },
          });
          await tx.order.delete({ where: { id: source.id } });
          mergedOrders += 1;
        }
      }

      await tx.orderAlias.deleteMany({ where: { orderId: targetId } });
      if (aliasNos.length > 0) {
        await tx.orderAlias.createMany({
          data: aliasNos.map((aliasNo) => ({ orderId: targetId, aliasNo })),
          skipDuplicates: true,
        });
      }

      await refreshOrderBalance(tx, targetId);
    });

    mergedGroups += 1;
  }

  console.log(JSON.stringify({ mergedGroups, mergedOrders, createdGroups }, null, 2));
}

run()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
