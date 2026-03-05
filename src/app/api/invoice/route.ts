import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { db } from '@/lib/db';
import { UserRole } from '@prisma/client';
import { updateOrderBalance } from '@/lib/matching';
import { withAuth, withRole } from '@/lib/route-auth';
import { serializeOrderTokens } from '@/lib/tokenizer';
import { resolveCustomer } from '@/lib/customer-matching';
import { deriveOrderGroupKey } from '@/lib/order-group';
import { saveInvoiceWithOrders } from '@/lib/invoice-write';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { canonicalizeOrderNo, normalizeOrderNo } from '@/lib/order-alias';
import { consolidateGroupedOrders, findOrderIdByNoOrAlias, syncOrderAliases } from '@/lib/order-alias-db';

function parseDateInput(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

// 获取账单列表
export const GET = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const scope = await getHierarchyScope(currentUser);
    const ownerIds = Array.from(scope.ownerVisibleIds);
    const { searchParams } = new URL(request.url);
    const action = (searchParams.get('action') || '').trim();
    const search = (searchParams.get('search') || '').trim();
    const orderId = searchParams.get('orderId');
    const orderNo = (searchParams.get('orderNo') || '').trim();

    if (action === 'import-template') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('invoice_import');
      sheet.columns = [
        { header: 'INV_NO', key: 'invNo', width: 22 },
        { header: 'SHIP_DATE', key: 'shipDate', width: 16 },
        { header: 'RELEASE_DATE', key: 'releaseDate', width: 16 },
        { header: 'ORDER_NO', key: 'orderNo', width: 26 },
        { header: 'AMOUNT', key: 'amount', width: 14 },
        { header: 'CUSTOMER_MARK', key: 'customerMark', width: 22 },
        { header: 'CUSTOMER_ORDER_NAME', key: 'customerName', width: 24 },
        { header: 'CUSTOMER_ID', key: 'customerId', width: 28 },
      ];
      sheet.addRow({
        invNo: 'INV-2026-001',
        shipDate: '2026-03-01',
        releaseDate: '2026-03-03',
        orderNo: 'IB-31A/IB-32/IB-33B',
        amount: 1200,
        customerMark: 'IB',
        customerName: 'IB',
        customerId: '',
      });
      sheet.getRow(1).font = { bold: true };
      const buffer = await workbook.xlsx.writeBuffer();
      return new NextResponse(Buffer.from(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="invoice-import-template.xlsx"',
        },
      });
    }

    if (orderId) {
      const accessibleOrder = await db.order.findFirst({
        where: {
          id: orderId,
          OR: [
            { createdBy: { in: ownerIds } },
            { customer: { createdBy: { in: ownerIds } } },
          ],
        },
        select: { id: true },
      });
      if (!accessibleOrder) return NextResponse.json({ success: true, data: [] });

      const receipts = await db.receipt.findMany({
        where: {
          orderId,
          OR: [
            { createdBy: { in: ownerIds } },
            { customer: { createdBy: { in: ownerIds } } },
          ],
        },
        select: {
          id: true,
          receiptNo: true,
          usd: true,
          status: true,
          date: true,
          createdAt: true,
          payer: true,
          invNo: true,
          orderNo: true,
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 30,
      });
      return NextResponse.json({ success: true, data: receipts });
    }

    if (orderNo) {
      const visibilityWhere = buildOrderVisibilityWhere(ownerIds);
      const matchedOrderId = await findOrderIdByNoOrAlias(orderNo, visibilityWhere);
      if (matchedOrderId) {
        const matchedOrder = await db.order.findUnique({
          where: { id: matchedOrderId },
          select: {
            id: true,
            orderNo: true,
            customerId: true,
            customerMark: true,
            customerName: true,
            customerPhone: true,
            customerCity: true,
            needsCustomerFix: true,
            createdAt: true,
          },
        });
        return NextResponse.json({ success: true, data: matchedOrder ? [matchedOrder] : [] });
      }

      const targetKey = deriveOrderGroupKey(orderNo);
      if (!targetKey) {
        return NextResponse.json({ success: true, data: [] });
      }
      const allOrders = await db.order.findMany({
        where: visibilityWhere,
        select: {
          id: true,
          orderNo: true,
          customerId: true,
          customerMark: true,
          customerName: true,
          customerPhone: true,
          customerCity: true,
          needsCustomerFix: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      const matched = allOrders.filter((row) => deriveOrderGroupKey(row.orderNo) === targetKey);
      return NextResponse.json({ success: true, data: matched });
    }

    const baseVisibilityWhere = {
      OR: [
        { createdBy: { in: ownerIds } },
        { orders: { some: { createdBy: { in: ownerIds } } } },
        { orders: { some: { customer: { createdBy: { in: ownerIds } } } } },
      ],
    };
    const invoices = await db.invoice.findMany({
      where: search
        ? {
            AND: [
              baseVisibilityWhere,
              {
                OR: [
                  { invNo: { contains: search } },
                  {
                    orders: {
                      some: {
                        orderNo: { contains: search },
                        OR: [
                          { createdBy: { in: ownerIds } },
                          { customer: { createdBy: { in: ownerIds } } },
                        ],
                      },
                    },
                  },
                ],
              },
            ],
          }
        : baseVisibilityWhere,
      include: {
        orders: {
          where: {
            OR: [
              { createdBy: { in: ownerIds } },
              { customer: { createdBy: { in: ownerIds } } },
            ],
          },
          include: {
            receipts: {
              where: {
                orderId: { not: null },
                OR: [
                  { createdBy: { in: ownerIds } },
                  { customer: { createdBy: { in: ownerIds } } },
                ],
              },
              select: { usd: true, status: true }
            }
          }
        },
        creator: { select: { id: true, name: true, email: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    const normalizedSearch = search.toLowerCase();
    const filteredInvoices = search
      ? invoices
          .map((invoice) => {
            const invMatched = invoice.invNo.toLowerCase().includes(normalizedSearch);
            if (invMatched) return invoice;
            return {
              ...invoice,
              orders: invoice.orders.filter((order) =>
                order.orderNo.toLowerCase().includes(normalizedSearch)
              ),
            };
          })
          .filter((invoice) => invoice.orders.length > 0)
      : invoices;

    // 计算每个账单的总金额和余额
    const result = filteredInvoices.map(invoice => {
      const invAmount = invoice.orders.reduce((sum, order) => sum + Number(order.amount), 0);
      const receivedAmount = invoice.orders.reduce((sum, order) => {
        return sum + order.receipts.reduce((s, r) => s + Number(r.usd), 0);
      }, 0);
      const invBalance = invAmount - receivedAmount;

      return {
        ...invoice,
        invAmount,
        invBalance,
        orders: invoice.orders.map(order => {
          const orderReceived = order.receipts.reduce((s, r) => s + Number(r.usd), 0);

          return {
            ...order,
            orderBalance: Number(order.amount) - orderReceived,
            isSystemOrder: false,
          };
        })
      };
    });

    // 排序：DEPOSIT_POOL、Un_Associated 置顶，其他按创建时间倒序
    result.sort((a, b) => {
      const rank = (invNo: string) => {
        if (invNo === 'DEPOSIT_POOL') return 0;
        if (invNo === 'Un_Associated') return 1;
        return 2;
      };
      const rankA = rank(a.invNo);
      const rankB = rank(b.invNo);
      if (rankA !== rankB) return rankA - rankB;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('Get invoices error:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
});

// 创建账单
export const POST = withRole([UserRole.ADMIN, UserRole.SALES], async (request: NextRequest, currentUser) => {
  try {
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const action = String(form.get('action') || '');
      if (action !== 'import-excel') {
        return NextResponse.json({ success: false, error: '未知上传操作' }, { status: 400 });
      }

      const file = form.get('file');
      if (!(file instanceof File)) {
        return NextResponse.json({ success: false, error: '请上传Excel文件' }, { status: 400 });
      }

      const workbook = new ExcelJS.Workbook();
      const arrayBuffer = await file.arrayBuffer();
      await workbook.xlsx.load(Buffer.from(arrayBuffer));
      const sheet = workbook.worksheets[0];
      if (!sheet) {
        return NextResponse.json({ success: false, error: 'Excel为空' }, { status: 400 });
      }

      const headerRow = sheet.getRow(1);
      const headerMap = new Map<string, number>();
      for (let i = 1; i <= sheet.columnCount; i++) {
        const raw = String(headerRow.getCell(i).value || '').trim().toUpperCase();
        if (raw) headerMap.set(raw, i);
      }
      const required = ['INV_NO', 'ORDER_NO', 'AMOUNT', 'CUSTOMER_MARK'];
      const missing = required.filter((h) => !headerMap.has(h));
      if (missing.length > 0) {
        return NextResponse.json({ success: false, error: `模板缺少列: ${missing.join(', ')}` }, { status: 400 });
      }

      const grouped = new Map<string, {
        shipDate: Date | null | undefined;
        releaseDate: Date | null | undefined;
        rows: Array<{ orderNo: string; amount: number; customerMark: string; customerName?: string; customerId?: string }>;
      }>();
      const errors: string[] = [];

      for (let rowNo = 2; rowNo <= sheet.rowCount; rowNo++) {
        const row = sheet.getRow(rowNo);
        const invNo = String(row.getCell(headerMap.get('INV_NO')!).value || '').trim();
        const shipDateRaw = headerMap.get('SHIP_DATE') ? String(row.getCell(headerMap.get('SHIP_DATE')!).value || '').trim() : '';
        const releaseDateRaw = headerMap.get('RELEASE_DATE') ? String(row.getCell(headerMap.get('RELEASE_DATE')!).value || '').trim() : '';
        const orderNo = String(row.getCell(headerMap.get('ORDER_NO')!).value || '').trim();
        const amountRaw = String(row.getCell(headerMap.get('AMOUNT')!).value || '').trim();
        const customerMark = String(row.getCell(headerMap.get('CUSTOMER_MARK')!).value || '').trim();
        const customerOrderNameCol = headerMap.get('CUSTOMER_ORDER_NAME');
        const customerIdCol = headerMap.get('CUSTOMER_ID');
        const customerName = customerOrderNameCol ? String(row.getCell(customerOrderNameCol).value || '').trim() : '';
        const customerId = customerIdCol ? String(row.getCell(customerIdCol).value || '').trim() : '';

        if (!invNo && !orderNo && !amountRaw && !customerMark && !shipDateRaw && !releaseDateRaw) continue;

        const rowErrors: string[] = [];
        const amount = Number(amountRaw);
        const shipDate = shipDateRaw ? parseDateInput(shipDateRaw) : undefined;
        const releaseDate = releaseDateRaw ? parseDateInput(releaseDateRaw) : undefined;
        if (!invNo) rowErrors.push(`第${rowNo}行 INV_NO 不能为空`);
        if (!orderNo) rowErrors.push(`第${rowNo}行 ORDER_NO 不能为空`);
        if (!customerMark) rowErrors.push(`第${rowNo}行 CUSTOMER_MARK 不能为空`);
        if (!Number.isFinite(amount) || amount <= 0) rowErrors.push(`第${rowNo}行 AMOUNT 必须大于0`);
        if (shipDateRaw && shipDate === undefined) rowErrors.push(`第${rowNo}行 SHIP_DATE 格式错误，应为 YYYY-MM-DD`);
        if (releaseDateRaw && releaseDate === undefined) rowErrors.push(`第${rowNo}行 RELEASE_DATE 格式错误，应为 YYYY-MM-DD`);
        if (rowErrors.length > 0) {
          errors.push(...rowErrors);
          continue;
        }

        if (!grouped.has(invNo)) {
          grouped.set(invNo, {
            shipDate,
            releaseDate,
            rows: [],
          });
        }
        const bucket = grouped.get(invNo)!;
        if (shipDate !== undefined) bucket.shipDate = shipDate;
        if (releaseDate !== undefined) bucket.releaseDate = releaseDate;
        bucket.rows.push({
          orderNo,
          amount,
          customerMark,
          customerName: customerName || undefined,
          customerId: customerId || undefined,
        });
      }

      if (errors.length > 0) {
        return NextResponse.json({ success: false, error: 'Excel校验失败', details: errors.slice(0, 200) }, { status: 400 });
      }
      if (grouped.size === 0) {
        return NextResponse.json({ success: false, error: '没有可导入的数据行' }, { status: 400 });
      }

      const messages: string[] = [];
      for (const [invNo, group] of grouped.entries()) {
        const saved = await saveInvoiceWithOrders({
          invNo,
          orders: group.rows,
          createdBy: currentUser.id,
          shipDate: group.shipDate,
          releaseDate: group.releaseDate,
        });
        if (!saved.ok) {
          return NextResponse.json({ success: false, error: `导入失败(INV_NO=${invNo}): ${saved.error}` }, { status: saved.status });
        }
        messages.push(`${invNo}: ${saved.message}`);
      }
      return NextResponse.json({ success: true, message: `导入完成，共 ${grouped.size} 个账单`, details: messages });
    }

    const body = await request.json();
    const { invNo, orders, shipDate, releaseDate } = body;
    const parsedShipDate = parseDateInput(shipDate);
    const parsedReleaseDate = parseDateInput(releaseDate);
    if (shipDate && parsedShipDate === undefined) {
      return NextResponse.json({ success: false, error: 'SHIP_DATE 格式错误，应为 YYYY-MM-DD' }, { status: 400 });
    }
    if (releaseDate && parsedReleaseDate === undefined) {
      return NextResponse.json({ success: false, error: 'RELEASE_DATE 格式错误，应为 YYYY-MM-DD' }, { status: 400 });
    }
    const saved = await saveInvoiceWithOrders({
      invNo: String(invNo || ''),
      orders: Array.isArray(orders) ? orders : [],
      createdBy: currentUser.id,
      shipDate: parsedShipDate,
      releaseDate: parsedReleaseDate,
    });
    if (!saved.ok) {
      return NextResponse.json({ success: false, error: saved.error }, { status: saved.status });
    }
    return NextResponse.json({ success: true, data: saved.data, message: saved.message });
  } catch (error) {
    console.error('Create invoice error:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}, '只有管理员和销售代表可以创建账单');

// 删除账单
export const DELETE = withRole([UserRole.ADMIN, UserRole.SALES], async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: '账单ID不能为空' }, { status: 400 });
    }

    // 检查是否有关联的收据
    const orders = await db.order.findMany({ where: { invoiceId: id } });
    const orderIds = orders.map(o => o.id);
    const receipts = await db.receipt.findFirst({ where: { orderId: { in: orderIds } } });

    if (receipts) {
      return NextResponse.json({ success: false, error: '该账单下有收据，无法删除' }, { status: 400 });
    }

    await db.invoice.delete({ where: { id } });
    return NextResponse.json({ success: true, message: '账单已删除' });
  } catch (error) {
    console.error('Delete invoice error:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}, '只有管理员和销售代表可以删除账单');

function buildOrderVisibilityWhere(ownerIds: string[]) {
  return {
    OR: [
      { createdBy: { in: ownerIds } },
      { customer: { createdBy: { in: ownerIds } } },
    ],
  };
}

function buildReceiptVisibilityWhere(ownerIds: string[]) {
  return {
    OR: [
      { createdBy: { in: ownerIds } },
      { customer: { createdBy: { in: ownerIds } } },
    ],
  };
}

// 重新匹配当前可见范围内订单
async function rematchAllOrders(ownerIds: string[]) {
  console.log('[Rematch] Starting rematch all orders...');

  const orderVisibilityWhere = buildOrderVisibilityWhere(ownerIds);
  const receiptVisibilityWhere = buildReceiptVisibilityWhere(ownerIds);

  // 获取可见范围内订单
  const allOrders = await db.order.findMany({
    where: orderVisibilityWhere,
    include: {
      invoice: true,
      receipts: true
    }
  });

  let mergedCount = 0;
  let receiptMatchedCount = 0;
  let customerSyncedCount = 0;
  let deletedInvoiceCount = 0;
  let deletedZeroOrdersCount = 0;

  // 按订单号分组，找出重复的订单
  const orderGroups = new Map<string, typeof allOrders>();
  
  for (const order of allOrders) {
    const normalizedOrderNo = normalizeOrderNo(order.orderNo);
    const key = normalizedOrderNo;
    
    if (!orderGroups.has(key)) {
      orderGroups.set(key, []);
    }
    orderGroups.get(key)!.push(order);
  }

  // 处理每组重复订单
  for (const [normalizedOrderNo, orders] of orderGroups) {
    if (orders.length <= 1) continue;
    
    // 找出非Un_Associated的订单作为目标（优先保留）
    const targetOrder = orders.find(o => o.invoice.invNo !== 'Un_Associated') || orders[0];
    const sourceOrders = orders.filter(o => o.id !== targetOrder.id);

    console.log(`[Rematch] Merging ${sourceOrders.length} orders into ${targetOrder.orderNo}`);

    for (const sourceOrder of sourceOrders) {
      // 将源订单的所有收据转移到目标订单
      await db.receipt.updateMany({
        where: { orderId: sourceOrder.id },
        data: { orderId: targetOrder.id }
      });

      // 删除源订单
      await db.order.delete({
        where: { id: sourceOrder.id }
      });

      mergedCount++;
    }

    // 重新计算目标订单余额
    await updateOrderBalance(targetOrder.id);
  }

  // 基于“同一客人”分组，同步可见范围内客户信息（按拆分元素去掉最右序号）
  const freshOrders = await db.order.findMany({
    where: orderVisibilityWhere,
    select: {
      id: true,
      orderNo: true,
      customerId: true,
      customerMark: true,
      customerName: true,
      customerPhone: true,
      customerCity: true,
      needsCustomerFix: true,
    },
  });
  const groupMap = new Map<string, typeof freshOrders>();
  for (const row of freshOrders) {
    const key = deriveOrderGroupKey(row.orderNo);
    if (!key) continue;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(row);
  }
  for (const [, grouped] of groupMap) {
    if (grouped.length <= 1) continue;
    const resolved = grouped.find((row) => row.customerId && !row.needsCustomerFix);
    if (!resolved) continue;

    const targetOrderIds = grouped.map((row) => row.id);
    const touched = await db.order.updateMany({
      where: { id: { in: targetOrderIds } },
      data: {
        customerId: resolved.customerId,
        customerMark: resolved.customerMark,
        customerName: resolved.customerName,
        customerPhone: resolved.customerPhone,
        customerCity: resolved.customerCity,
        needsCustomerFix: false,
      },
    });
    customerSyncedCount += touched.count;

    const receiptRows = await db.receipt.findMany({
      where: {
        ...receiptVisibilityWhere,
        orderNo: { not: null },
      },
      select: { id: true, orderNo: true },
    });
    const targetReceiptIds = receiptRows
      .filter((row) => deriveOrderGroupKey(row.orderNo) === deriveOrderGroupKey(resolved.orderNo))
      .map((row) => row.id);
    if (targetReceiptIds.length > 0) {
      const syncedReceipts = await db.receipt.updateMany({
        where: { id: { in: targetReceiptIds } },
        data: {
          customerId: resolved.customerId,
          customerMark: resolved.customerMark,
          customerName: resolved.customerName,
          customerPhone: resolved.customerPhone,
          customerCity: resolved.customerCity,
          needsCustomerFix: false,
        },
      });
      customerSyncedCount += syncedReceipts.count;
    }
  }

  // 重新匹配可见范围内“未挂单收据”到可见订单（优先精确，再按拆分规则）
  const allReceipts = await db.receipt.findMany({
    where: {
      ...receiptVisibilityWhere,
      orderId: null,
      orderNo: { not: null }
    }
  });

  console.log(`[Rematch] Found ${allReceipts.length} unmatched receipts with orderNo`);

  for (const receipt of allReceipts) {
    if (!receipt.orderNo) continue;

    const sameOrderId = await findOrderIdByNoOrAlias(receipt.orderNo, orderVisibilityWhere);
    if (sameOrderId) {
      await db.receipt.update({
        where: { id: receipt.id },
        data: { orderId: sameOrderId },
      });
      await updateOrderBalance(sameOrderId);
      receiptMatchedCount++;
      continue;
    }

    const key = deriveOrderGroupKey(receipt.orderNo);
    if (!key) continue;
    const groupOrders = await db.order.findMany({
      where: orderVisibilityWhere,
      orderBy: { createdAt: 'asc' },
    });
    const matchedByGroup = groupOrders.find((row) => deriveOrderGroupKey(row.orderNo) === key);
    if (matchedByGroup) {
      await db.receipt.update({
        where: { id: receipt.id },
        data: { orderId: matchedByGroup.id },
      });
      await updateOrderBalance(matchedByGroup.id);
      receiptMatchedCount++;
    }
  }

  // 删除“本次处理触达范围”中的空账单
  const touchedInvoiceIds = Array.from(new Set(allOrders.map((row) => row.invoiceId)));
  const invoices = touchedInvoiceIds.length > 0
    ? await db.invoice.findMany({
        where: { id: { in: touchedInvoiceIds } },
        select: { id: true, invNo: true, _count: { select: { orders: true } } },
      })
    : [];
  for (const invoice of invoices) {
    if (invoice._count.orders === 0) {
      await db.invoice.delete({ where: { id: invoice.id } });
      deletedInvoiceCount++;
    }
  }

  // 仅重算可见范围内订单余额
  const orderIds = await db.order.findMany({ where: orderVisibilityWhere, select: { id: true } });
  for (const row of orderIds) {
    await updateOrderBalance(row.id);
  }

  // 清理可见范围内“金额=0 且 未收=0 且 无收据”的空订单
  const zeroOrders = await db.order.findMany({
    where: {
      AND: [
        orderVisibilityWhere,
        {
          amount: 0,
          orderBalance: 0,
        },
      ],
    },
    include: {
      _count: { select: { receipts: true } },
    },
  });
  for (const order of zeroOrders) {
    if (order._count.receipts > 0) continue;
    await db.order.delete({ where: { id: order.id } });
    deletedZeroOrdersCount++;
  }

  const consolidated = await consolidateGroupedOrders({ orderWhere: orderVisibilityWhere });

  console.log(
    `[Rematch] Completed. merged=${mergedCount}, matchedReceipts=${receiptMatchedCount}, syncedCustomers=${customerSyncedCount}, deletedInvoices=${deletedInvoiceCount}, deletedZeroOrders=${deletedZeroOrdersCount}, groupedOrders=${consolidated.mergedOrders}`
  );
  return {
    mergedCount,
    receiptMatchedCount,
    customerSyncedCount,
    deletedInvoiceCount,
    deletedZeroOrdersCount,
    groupedMergedCount: consolidated.mergedOrders,
    groupedCreatedCount: consolidated.createdGroups,
  };
}

type RematchConflictGroup = {
  groupId: string;
  groupType: 'exact' | 'customer-group';
  groupKey: string;
  orders: Array<{
    id: string;
    invoiceId: string;
    invNo: string;
    orderNo: string;
    amount: number;
    orderBalance: number;
    receiptCount: number;
    createdAt: Date;
  }>;
};

async function listRematchConflictGroupsByScope(ownerIds: string[]): Promise<RematchConflictGroup[]> {
  const orderVisibilityWhere = buildOrderVisibilityWhere(ownerIds);
  const receiptVisibilityWhere = buildReceiptVisibilityWhere(ownerIds);
  const orders = await db.order.findMany({
    where: orderVisibilityWhere,
    include: {
      invoice: { select: { id: true, invNo: true } },
      _count: { select: { receipts: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const normalized = (value: string) => value.trim().toLowerCase();
  const exactMap = new Map<string, typeof orders>();
  const groupMap = new Map<string, typeof orders>();
  const unmatchedReceipts = await db.receipt.findMany({
    where: {
      ...receiptVisibilityWhere,
      orderId: null,
      orderNo: { not: null },
    },
    select: { orderNo: true },
  });
  const unmatchedGroupCount = new Map<string, number>();
  for (const receipt of unmatchedReceipts) {
    const key = deriveOrderGroupKey(receipt.orderNo);
    if (!key) continue;
    unmatchedGroupCount.set(key, (unmatchedGroupCount.get(key) || 0) + 1);
  }

  for (const order of orders) {
    const exactKey = normalized(order.orderNo);
    if (!exactMap.has(exactKey)) exactMap.set(exactKey, []);
    exactMap.get(exactKey)!.push(order);

    const groupKey = deriveOrderGroupKey(order.orderNo);
    if (!groupKey) continue;
    if (!groupMap.has(groupKey)) groupMap.set(groupKey, []);
    groupMap.get(groupKey)!.push(order);
  }

  const groups: RematchConflictGroup[] = [];
  for (const [key, rows] of exactMap) {
    if (rows.length <= 1) continue;
    groups.push({
      groupId: `exact:${key}`,
      groupType: 'exact',
      groupKey: key,
      orders: rows.map((row) => ({
        id: row.id,
        invoiceId: row.invoice.id,
        invNo: row.invoice.invNo,
        orderNo: row.orderNo,
        amount: row.amount,
        orderBalance: row.orderBalance,
        receiptCount: row._count.receipts,
        createdAt: row.createdAt,
      })),
    });
  }
  for (const [key, rows] of groupMap) {
    if (rows.length <= 1) continue;
    const uniqueOrderNos = new Set(rows.map((row) => normalized(row.orderNo)));
    if (uniqueOrderNos.size <= 1) continue;
    // 仅当该客组存在“未匹配收据”时才提示冲突，避免把正常不同订单误判为冲突。
    if (!unmatchedGroupCount.get(key)) continue;
    groups.push({
      groupId: `group:${key}`,
      groupType: 'customer-group',
      groupKey: key,
      orders: rows.map((row) => ({
        id: row.id,
        invoiceId: row.invoice.id,
        invNo: row.invoice.invNo,
        orderNo: row.orderNo,
        amount: row.amount,
        orderBalance: row.orderBalance,
        receiptCount: row._count.receipts,
        createdAt: row.createdAt,
      })),
    });
  }

  groups.sort((a, b) => a.groupId.localeCompare(b.groupId));
  return groups;
}

async function applyRematchConflicts(
  resolutions: Array<{ groupId: string; keepOrderId: string; mode: 'keep' | 'merge'; orderIds: string[] }>,
  ownerIds: string[]
) {
  const orderVisibilityWhere = buildOrderVisibilityWhere(ownerIds);
  let mergedCount = 0;
  for (const resolution of resolutions) {
    const uniqueOrderIds = Array.from(new Set(resolution.orderIds.filter(Boolean)));
    if (uniqueOrderIds.length <= 1) continue;
    if (!uniqueOrderIds.includes(resolution.keepOrderId)) continue;

    const rows = await db.order.findMany({
      where: {
        AND: [
          { id: { in: uniqueOrderIds } },
          orderVisibilityWhere,
        ],
      },
      include: { receipts: { select: { id: true } } },
    });
    if (rows.length <= 1) continue;

    const keepRow = rows.find((row) => row.id === resolution.keepOrderId);
    if (!keepRow) continue;

    const sourceRows = rows.filter((row) => row.id !== keepRow.id);
    if (sourceRows.length === 0) continue;

    let incrementAmount = 0;
    for (const source of sourceRows) {
      await db.receipt.updateMany({
        where: { orderId: source.id },
        data: { orderId: keepRow.id },
      });
      if (resolution.mode === 'merge') {
        incrementAmount += Number(source.amount);
      }
      await db.order.delete({ where: { id: source.id } });
      mergedCount++;
    }

    if (incrementAmount !== 0) {
      await db.order.update({
        where: { id: keepRow.id },
        data: { amount: { increment: incrementAmount } },
      });
    }
    await updateOrderBalance(keepRow.id);
  }

  return { mergedCount };
}

// 更新订单
export const PUT = withRole([UserRole.ADMIN, UserRole.SALES], async (request: NextRequest, currentUser) => {
  try {
    const body = await request.json();
    const { action, orderId, orderNo, amount, invoiceId } = body;

    // 刷新匹配
    if (action === 'rematch-preview') {
      const scope = await getHierarchyScope(currentUser);
      const ownerIds = Array.from(scope.ownerVisibleIds);
      const groups = await listRematchConflictGroupsByScope(ownerIds);
      return NextResponse.json({ success: true, data: groups });
    }

    if (action === 'rematch-apply') {
      const scope = await getHierarchyScope(currentUser);
      const ownerIds = Array.from(scope.ownerVisibleIds);
      const resolutions = Array.isArray(body.resolutions) ? body.resolutions : [];
      const applied = await applyRematchConflicts(
        resolutions as Array<{ groupId: string; keepOrderId: string; mode: 'keep' | 'merge'; orderIds: string[] }>,
        ownerIds
      );
      const result = await rematchAllOrders(ownerIds);
      return NextResponse.json({
        success: true,
        message: `冲突处理完成（当前可见范围）：人工合并 ${applied.mergedCount}，自动合并 ${result.mergedCount}，组合合并 ${result.groupedMergedCount}，补匹配收据 ${result.receiptMatchedCount}，同步客户 ${result.customerSyncedCount}，清理空账单 ${result.deletedInvoiceCount}，清理空订单 ${result.deletedZeroOrdersCount}`,
      });
    }

    if (action === 'rematch') {
      const scope = await getHierarchyScope(currentUser);
      const ownerIds = Array.from(scope.ownerVisibleIds);
      const result = await rematchAllOrders(ownerIds);
      return NextResponse.json({ 
        success: true, 
        message: `重新匹配完成（当前可见范围）：合并重复订单 ${result.mergedCount}，组合合并 ${result.groupedMergedCount}，补匹配收据 ${result.receiptMatchedCount}，同步客户 ${result.customerSyncedCount}，清理空账单 ${result.deletedInvoiceCount}，清理空订单 ${result.deletedZeroOrdersCount}` 
      });
    }

    // 更新订单
    if (action === 'updateOrder') {
      if (!orderId) {
        return NextResponse.json({ success: false, error: '订单ID不能为空' }, { status: 400 });
      }

      const order = await db.order.findUnique({ where: { id: orderId } });
      if (!order) {
        return NextResponse.json({ success: false, error: '订单不存在' }, { status: 400 });
      }

      const incomingOrderNoRaw = typeof orderNo === 'string' ? orderNo.trim() : order.orderNo;
      const incomingOrderNo = canonicalizeOrderNo(incomingOrderNoRaw);
      const incomingAmount = amount !== undefined ? Number(amount) : order.amount;
      if (!incomingOrderNo) {
        return NextResponse.json({ success: false, error: '客户单号不能为空' }, { status: 400 });
      }
      if (!Number.isFinite(incomingAmount) || incomingAmount < 0) {
        return NextResponse.json({ success: false, error: '金额必须为大于等于0的数字' }, { status: 400 });
      }

      const incomingCustomerMark = typeof body.customerMark === 'string' ? body.customerMark.trim() : (order.customerMark || '');
      const incomingCustomerName = typeof body.customerName === 'string' ? body.customerName.trim() : (order.customerName || '');
      const incomingCustomerId = typeof body.customerId === 'string' ? body.customerId.trim() : (order.customerId || '');
      const incomingCustomerPhone = typeof body.customerPhone === 'string' ? body.customerPhone.trim() : (order.customerPhone || '');
      const incomingCustomerCity = typeof body.customerCity === 'string' ? body.customerCity.trim() : (order.customerCity || '');

      let customerData: {
        customerId: string | null;
        customerMark: string | null;
        customerName: string | null;
        customerPhone: string | null;
        customerCity: string | null;
        needsCustomerFix: boolean;
      } = {
        customerId: order.customerId,
        customerMark: order.customerMark,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        customerCity: order.customerCity,
        needsCustomerFix: order.needsCustomerFix,
      };

      if (incomingCustomerMark) {
        const resolved = await resolveCustomer({
          customerMark: incomingCustomerMark,
          customerName: incomingCustomerName || null,
          customerId: incomingCustomerId || null,
        });
        customerData = {
          customerId: resolved.customerId,
          customerMark: resolved.customerMark,
          customerName: resolved.customerName,
          customerPhone: resolved.customerPhone ?? (incomingCustomerPhone || null),
          customerCity: resolved.customerCity ?? (incomingCustomerCity || null),
          needsCustomerFix: resolved.needsCustomerFix,
        };
      } else {
        customerData = {
          customerId: null,
          customerMark: null,
          customerName: incomingCustomerName || null,
          customerPhone: incomingCustomerPhone || null,
          customerCity: incomingCustomerCity || null,
          needsCustomerFix: true,
        };
      }

      const updated = await db.order.update({
        where: { id: orderId },
        data: {
          orderNo: incomingOrderNo,
          tokens: serializeOrderTokens(incomingOrderNo),
          amount: incomingAmount,
          customerId: customerData.customerId,
          customerMark: customerData.customerMark,
          customerName: customerData.customerName,
          customerPhone: customerData.customerPhone,
          customerCity: customerData.customerCity,
          needsCustomerFix: customerData.needsCustomerFix,
        }
      });
      await syncOrderAliases(db, orderId, incomingOrderNo);

      await db.receipt.updateMany({
        where: { orderId },
        data: {
          orderNo: incomingOrderNo,
          customerId: customerData.customerId,
          customerMark: customerData.customerMark,
          customerName: customerData.customerName,
          customerPhone: customerData.customerPhone,
          customerCity: customerData.customerCity,
          needsCustomerFix: customerData.needsCustomerFix,
        },
      });

      // 重新计算订单余额
      await updateOrderBalance(orderId);

      // 如果订单号有变化，触发重新匹配
      if (normalizeOrderNo(incomingOrderNo) !== normalizeOrderNo(order.orderNo)) {
        console.log(`[UpdateOrder] OrderNo changed from "${order.orderNo}" to "${incomingOrderNo}", triggering rematch...`);
        const scope = await getHierarchyScope(currentUser);
        const ownerIds = Array.from(scope.ownerVisibleIds);
        await rematchAllOrders(ownerIds);
      }

      return NextResponse.json({ success: true, data: updated });
    }

    // 添加订单到账单
    if (action === 'addOrder') {
      const customerMark = typeof body.customerMark === 'string' ? body.customerMark.trim() : '';
      const customerName = typeof body.customerName === 'string' ? body.customerName.trim() : '';
      const customerId = typeof body.customerId === 'string' ? body.customerId.trim() : '';
      const incomingOrderNo = canonicalizeOrderNo(typeof orderNo === 'string' ? orderNo : '');
      const incomingAmount = Number(amount);
      if (!invoiceId || !incomingOrderNo || !Number.isFinite(incomingAmount) || incomingAmount <= 0 || !customerMark) {
        return NextResponse.json({ success: false, error: '缺少必要参数' }, { status: 400 });
      }
      const customerResolution = await resolveCustomer({
        customerMark,
        customerName: customerName || null,
        customerId: customerId || null,
      });

      const existingOrderId = await findOrderIdByNoOrAlias(incomingOrderNo);
      const existingOrder = existingOrderId
        ? await db.order.findUnique({
            where: { id: existingOrderId },
            include: { invoice: true },
          })
        : null;

      if (existingOrder) {
        const updated = await db.order.update({
          where: { id: existingOrder.id },
          data: {
            ...(normalizeOrderNo(existingOrder.orderNo) !== normalizeOrderNo(incomingOrderNo)
              ? {
                  orderNo: incomingOrderNo,
                  tokens: serializeOrderTokens(incomingOrderNo),
                }
              : {}),
            amount: { increment: incomingAmount },
            orderBalance: { increment: incomingAmount },
            customerId: customerResolution.customerId,
            customerMark: customerResolution.customerMark,
            customerName: customerResolution.customerName,
            customerPhone: customerResolution.customerPhone,
            customerCity: customerResolution.customerCity,
            needsCustomerFix: customerResolution.needsCustomerFix,
          }
        });
        await syncOrderAliases(db, updated.id, incomingOrderNo);
        await consolidateGroupedOrders({ invoiceIds: [updated.invoiceId] });
        console.log(`[AddOrder] Merged to existing order ${existingOrder.orderNo}, new amount: ${updated.amount}`);
        return NextResponse.json({ success: true, data: updated, merged: true });
      }

      const order = await db.order.create({
        data: {
          invoiceId,
          orderNo: incomingOrderNo,
          tokens: serializeOrderTokens(incomingOrderNo),
          amount: incomingAmount,
          orderBalance: incomingAmount,
          createdBy: currentUser.id,
          customerId: customerResolution.customerId,
          customerMark: customerResolution.customerMark,
          customerName: customerResolution.customerName,
          customerPhone: customerResolution.customerPhone,
          customerCity: customerResolution.customerCity,
          needsCustomerFix: customerResolution.needsCustomerFix,
        }
      });
      await syncOrderAliases(db, order.id, incomingOrderNo);
      await consolidateGroupedOrders({ invoiceIds: [invoiceId] });
      await updateOrderBalance(order.id);

      return NextResponse.json({ success: true, data: order });
    }

    // 删除订单
    if (action === 'deleteOrder') {
      if (!orderId) {
        return NextResponse.json({ success: false, error: '订单ID不能为空' }, { status: 400 });
      }

      // 检查订单是否有关联的收据
      const receipts = await db.receipt.findFirst({ where: { orderId } });
      if (receipts) {
        return NextResponse.json({ success: false, error: '该订单下有收据，无法删除' }, { status: 400 });
      }

      const deletingOrder = await db.order.findUnique({
        where: { id: orderId },
        select: { invoiceId: true },
      });
      if (!deletingOrder) {
        return NextResponse.json({ success: false, error: '订单不存在' }, { status: 400 });
      }

      await db.order.delete({ where: { id: orderId } });

      const remaining = await db.order.count({ where: { invoiceId: deletingOrder.invoiceId } });
      if (remaining === 0) {
        await db.invoice.delete({ where: { id: deletingOrder.invoiceId } });
      }
      return NextResponse.json({ success: true, message: '订单已删除' });
    }

    // 转移余额
    if (action === 'transferBalance') {
      const { fromOrderId, toOrderNo, transferAmount } = body;
      const canonicalToOrderNo = canonicalizeOrderNo(typeof toOrderNo === 'string' ? toOrderNo : '');
      
      if (!fromOrderId || !canonicalToOrderNo || transferAmount === undefined || transferAmount <= 0) {
        return NextResponse.json({ success: false, error: '缺少必要参数或金额无效' }, { status: 400 });
      }

      // 获取源订单
      const fromOrder = await db.order.findUnique({ where: { id: fromOrderId } });
      if (!fromOrder) {
        return NextResponse.json({ success: false, error: '源订单不存在' }, { status: 400 });
      }

      // 计算源订单当前余额
      const fromReceipts = await db.receipt.findMany({ where: { orderId: fromOrderId } });
      const fromReceived = fromReceipts.reduce((sum, r) => sum + Number(r.usd), 0);
      const fromBalance = Number(fromOrder.amount) - fromReceived;

      // 验证可转移余额（负数表示多付）
      if (fromBalance >= 0) {
        return NextResponse.json({ success: false, error: '该订单没有多付余额可转移' }, { status: 400 });
      }

      // 验证转移金额不超过多付金额
      if (transferAmount > Math.abs(fromBalance)) {
        return NextResponse.json({ success: false, error: `转移金额不能超过多付金额 $${Math.abs(fromBalance).toFixed(2)}` }, { status: 400 });
      }

      // 查找目标订单
      const matchedToOrderId = await findOrderIdByNoOrAlias(canonicalToOrderNo);
      let toOrder = matchedToOrderId
        ? await db.order.findUnique({ where: { id: matchedToOrderId } })
        : null;

      // 如果目标订单不存在，创建到 Un_Associated
      if (!toOrder) {
        // 查找或创建 Un_Associated 账单
        let unAssociated = await db.invoice.findFirst({
          where: { invNo: 'Un_Associated' }
        });
        
        if (!unAssociated) {
          unAssociated = await db.invoice.create({
            data: {
              invNo: 'Un_Associated',
              createdBy: currentUser.id
            }
          });
          console.log('[Transfer] Created Un_Associated invoice');
        }

        // 创建订单，金额为0，因为转移金额会通过收据来体现
        toOrder = await db.order.create({
          data: {
            invoiceId: unAssociated.id,
            orderNo: canonicalToOrderNo,
            tokens: serializeOrderTokens(canonicalToOrderNo),
            amount: 0,  // Un_Associated 下的订单金额为0
            orderBalance: 0,
            createdBy: currentUser.id,
            needsCustomerFix: true,
          }
        });
        await syncOrderAliases(db, toOrder.id, canonicalToOrderNo);
        console.log(`[Transfer] Created new order in Un_Associated: ${canonicalToOrderNo}`);
      }

      // 创建余额转移记录
      await db.balanceTransfer.create({
        data: {
          fromOrderId,
          toOrderId: toOrder.id,
          amount: transferAmount,
          createdBy: currentUser.id
        }
      });

      // 更新源订单金额（增加金额以减少多付状态）
      // 例如：amount=100, receipts=150, balance=-50
      // 转移30后：amount=130, receipts=150, balance=-20
      await db.order.update({
        where: { id: fromOrderId },
        data: { amount: { increment: transferAmount } }
      });

      // 为目标订单创建一个转移收据，减少其未收余额
      // 目标订单：balance = amount - receipts
      // 创建收据后，receipts增加，balance减少
      await db.receipt.create({
        data: {
          receiptNo: `TRANSFER-${Date.now()}`,
          usd: transferAmount,
          orderNo: canonicalToOrderNo,
          payer: `余额转移自 ${fromOrder.orderNo}`,
          status: 'Bank_Transfer',
          orderId: toOrder.id,
          needsCustomerFix: true,
          note: `从订单 ${fromOrder.orderNo} 转移的余额`,
          createdBy: currentUser.id
        }
      });

      // 重新计算两个订单的余额
      await updateOrderBalance(fromOrderId);
      await updateOrderBalance(toOrder.id);

      return NextResponse.json({ 
        success: true, 
        message: `成功转移 $${transferAmount.toFixed(2)} 到订单 ${canonicalToOrderNo}` 
      });
    }

    return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
  } catch (error) {
    console.error('Update order error:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}, '只有管理员和销售代表可以修改订单');
