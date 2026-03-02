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
        { header: 'ORDER_NO', key: 'orderNo', width: 26 },
        { header: 'AMOUNT', key: 'amount', width: 14 },
        { header: 'CUSTOMER_MARK', key: 'customerMark', width: 22 },
        { header: 'CUSTOMER_ORDER_NAME', key: 'customerName', width: 24 },
        { header: 'CUSTOMER_ID', key: 'customerId', width: 28 },
      ];
      sheet.addRow({
        invNo: 'INV-2026-001',
        orderNo: 'MAB-1-05',
        amount: 1200,
        customerMark: 'MAB-1',
        customerName: 'MAB-1',
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
      const targetKey = deriveOrderGroupKey(orderNo);
      if (!targetKey) {
        return NextResponse.json({ success: true, data: [] });
      }
      const allOrders = await db.order.findMany({
        where: {
          OR: [
            { createdBy: { in: ownerIds } },
            { customer: { createdBy: { in: ownerIds } } },
          ],
        },
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

      const grouped = new Map<string, Array<{ orderNo: string; amount: number; customerMark: string; customerName?: string; customerId?: string }>>();
      const errors: string[] = [];

      for (let rowNo = 2; rowNo <= sheet.rowCount; rowNo++) {
        const row = sheet.getRow(rowNo);
        const invNo = String(row.getCell(headerMap.get('INV_NO')!).value || '').trim();
        const orderNo = String(row.getCell(headerMap.get('ORDER_NO')!).value || '').trim();
        const amountRaw = String(row.getCell(headerMap.get('AMOUNT')!).value || '').trim();
        const customerMark = String(row.getCell(headerMap.get('CUSTOMER_MARK')!).value || '').trim();
        const customerOrderNameCol = headerMap.get('CUSTOMER_ORDER_NAME');
        const customerIdCol = headerMap.get('CUSTOMER_ID');
        const customerName = customerOrderNameCol ? String(row.getCell(customerOrderNameCol).value || '').trim() : '';
        const customerId = customerIdCol ? String(row.getCell(customerIdCol).value || '').trim() : '';

        if (!invNo && !orderNo && !amountRaw && !customerMark) continue;

        const rowErrors: string[] = [];
        const amount = Number(amountRaw);
        if (!invNo) rowErrors.push(`第${rowNo}行 INV_NO 不能为空`);
        if (!orderNo) rowErrors.push(`第${rowNo}行 ORDER_NO 不能为空`);
        if (!customerMark) rowErrors.push(`第${rowNo}行 CUSTOMER_MARK 不能为空`);
        if (!Number.isFinite(amount) || amount <= 0) rowErrors.push(`第${rowNo}行 AMOUNT 必须大于0`);
        if (rowErrors.length > 0) {
          errors.push(...rowErrors);
          continue;
        }

        if (!grouped.has(invNo)) grouped.set(invNo, []);
        grouped.get(invNo)!.push({
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
      for (const [invNo, rows] of grouped.entries()) {
        const saved = await saveInvoiceWithOrders({
          invNo,
          orders: rows,
          createdBy: currentUser.id,
        });
        if (!saved.ok) {
          return NextResponse.json({ success: false, error: `导入失败(INV_NO=${invNo}): ${saved.error}` }, { status: saved.status });
        }
        messages.push(`${invNo}: ${saved.message}`);
      }
      return NextResponse.json({ success: true, message: `导入完成，共 ${grouped.size} 个账单`, details: messages });
    }

    const body = await request.json();
    const { invNo, orders } = body;
    const saved = await saveInvoiceWithOrders({
      invNo: String(invNo || ''),
      orders: Array.isArray(orders) ? orders : [],
      createdBy: currentUser.id,
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

// 重新匹配所有订单
async function rematchAllOrders() {
  console.log('[Rematch] Starting rematch all orders...');

  const normalizeOrderNo = (value: string | null | undefined) => (value || '').trim().toLowerCase();

  // 获取所有订单
  const allOrders = await db.order.findMany({
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

  // 基于“同一客人”分组，同步客户信息（按拆分元素去掉最右序号）
  const freshOrders = await db.order.findMany({
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
      where: { orderNo: { not: null } },
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

  // 重新匹配收据到订单（优先精确，再按拆分规则）
  const allReceipts = await db.receipt.findMany({
    where: {
      orderId: null,
      orderNo: { not: null }
    }
  });

  console.log(`[Rematch] Found ${allReceipts.length} unmatched receipts with orderNo`);

  for (const receipt of allReceipts) {
    if (!receipt.orderNo) continue;
    
    const normalizedOrderNo = normalizeOrderNo(receipt.orderNo);
    const sameOrder = await db.order.findFirst({
      where: {
        orderNo: { equals: receipt.orderNo },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (sameOrder) {
      await db.receipt.update({
        where: { id: receipt.id },
        data: { orderId: sameOrder.id },
      });
      await updateOrderBalance(sameOrder.id);
      receiptMatchedCount++;
      continue;
    }

    const key = deriveOrderGroupKey(receipt.orderNo);
    if (!key) continue;
    const groupOrders = await db.order.findMany({
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

  // 删除空账单分支
  const invoices = await db.invoice.findMany({
    select: { id: true, invNo: true, _count: { select: { orders: true } } },
  });
  for (const invoice of invoices) {
    if (invoice._count.orders === 0) {
      await db.invoice.delete({ where: { id: invoice.id } });
      deletedInvoiceCount++;
    }
  }

  // 全量重算余额
  const orderIds = await db.order.findMany({ select: { id: true } });
  for (const row of orderIds) {
    await updateOrderBalance(row.id);
  }

  // 清理“金额=0 且 未收=0 且 无收据”的空订单
  const zeroOrders = await db.order.findMany({
    where: {
      amount: 0,
      orderBalance: 0,
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

  console.log(
    `[Rematch] Completed. merged=${mergedCount}, matchedReceipts=${receiptMatchedCount}, syncedCustomers=${customerSyncedCount}, deletedInvoices=${deletedInvoiceCount}, deletedZeroOrders=${deletedZeroOrdersCount}`
  );
  return { mergedCount, receiptMatchedCount, customerSyncedCount, deletedInvoiceCount, deletedZeroOrdersCount };
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

async function listRematchConflictGroups(): Promise<RematchConflictGroup[]> {
  const orders = await db.order.findMany({
    include: {
      invoice: { select: { id: true, invNo: true } },
      _count: { select: { receipts: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const normalized = (value: string) => value.trim().toLowerCase();
  const exactMap = new Map<string, typeof orders>();
  const groupMap = new Map<string, typeof orders>();
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
  resolutions: Array<{ groupId: string; keepOrderId: string; mode: 'keep' | 'merge'; orderIds: string[] }>
) {
  let mergedCount = 0;
  for (const resolution of resolutions) {
    const uniqueOrderIds = Array.from(new Set(resolution.orderIds.filter(Boolean)));
    if (uniqueOrderIds.length <= 1) continue;
    if (!uniqueOrderIds.includes(resolution.keepOrderId)) continue;

    const rows = await db.order.findMany({
      where: { id: { in: uniqueOrderIds } },
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
        incrementAmount += source.amount;
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
      const groups = await listRematchConflictGroups();
      return NextResponse.json({ success: true, data: groups });
    }

    if (action === 'rematch-apply') {
      const resolutions = Array.isArray(body.resolutions) ? body.resolutions : [];
      const applied = await applyRematchConflicts(
        resolutions as Array<{ groupId: string; keepOrderId: string; mode: 'keep' | 'merge'; orderIds: string[] }>
      );
      const result = await rematchAllOrders();
      return NextResponse.json({
        success: true,
        message: `冲突处理完成：人工合并 ${applied.mergedCount}，自动合并 ${result.mergedCount}，补匹配收据 ${result.receiptMatchedCount}，同步客户 ${result.customerSyncedCount}，清理空账单 ${result.deletedInvoiceCount}，清理空订单 ${result.deletedZeroOrdersCount}`,
      });
    }

    if (action === 'rematch') {
      const result = await rematchAllOrders();
      return NextResponse.json({ 
        success: true, 
        message: `重新匹配完成：合并重复订单 ${result.mergedCount}，补匹配收据 ${result.receiptMatchedCount}，同步客户 ${result.customerSyncedCount}，清理空账单 ${result.deletedInvoiceCount}，清理空订单 ${result.deletedZeroOrdersCount}` 
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

      const incomingOrderNo = typeof orderNo === 'string' ? orderNo.trim() : order.orderNo;
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
      if (incomingOrderNo !== order.orderNo) {
        console.log(`[UpdateOrder] OrderNo changed from "${order.orderNo}" to "${incomingOrderNo}", triggering rematch...`);
        await rematchAllOrders();
      }

      return NextResponse.json({ success: true, data: updated });
    }

    // 添加订单到账单
    if (action === 'addOrder') {
      const customerMark = typeof body.customerMark === 'string' ? body.customerMark.trim() : '';
      const customerName = typeof body.customerName === 'string' ? body.customerName.trim() : '';
      const customerId = typeof body.customerId === 'string' ? body.customerId.trim() : '';
      if (!invoiceId || !orderNo || amount === undefined || !customerMark) {
        return NextResponse.json({ success: false, error: '缺少必要参数' }, { status: 400 });
      }
      const customerResolution = await resolveCustomer({
        customerMark,
        customerName: customerName || null,
        customerId: customerId || null,
      });

      // 先检查是否已存在相同订单号的订单
      const existingOrder = await db.order.findFirst({
        where: {
          orderNo: {
            equals: orderNo
          }
        },
        include: { invoice: true }
      });

      if (existingOrder) {
        // 如果已存在，增加金额到现有订单
        const updated = await db.order.update({
          where: { id: existingOrder.id },
          data: {
            amount: { increment: amount },
            orderBalance: { increment: amount },
            customerId: customerResolution.customerId,
            customerMark: customerResolution.customerMark,
            customerName: customerResolution.customerName,
            customerPhone: customerResolution.customerPhone,
            customerCity: customerResolution.customerCity,
            needsCustomerFix: customerResolution.needsCustomerFix,
          }
        });
        console.log(`[AddOrder] Merged to existing order ${existingOrder.orderNo}, new amount: ${updated.amount}`);
        return NextResponse.json({ success: true, data: updated, merged: true });
      }

      const order = await db.order.create({
        data: {
          invoiceId,
          orderNo,
          tokens: serializeOrderTokens(orderNo),
          amount,
          orderBalance: amount,
          createdBy: currentUser.id,
          customerId: customerResolution.customerId,
          customerMark: customerResolution.customerMark,
          customerName: customerResolution.customerName,
          customerPhone: customerResolution.customerPhone,
          customerCity: customerResolution.customerCity,
          needsCustomerFix: customerResolution.needsCustomerFix,
        }
      });

      // 检查并合并 Un_Associated 中匹配的订单
      const systemPool = await db.invoice.findFirst({
        where: { invNo: 'Un_Associated' }
      });

      if (systemPool) {
        const systemOrders = await db.order.findMany({
          where: { invoiceId: systemPool.id }
        });

        const normalizedNewOrderNo = orderNo.toLowerCase().trim();
        
        for (const sysOrder of systemOrders) {
          const normalizedSysOrderNo = sysOrder.orderNo.toLowerCase().trim();
          
          // 检查是否匹配（双向包含或相等）
          const isMatch = normalizedNewOrderNo === normalizedSysOrderNo ||
                          normalizedNewOrderNo.includes(normalizedSysOrderNo) ||
                          normalizedSysOrderNo.includes(normalizedNewOrderNo);
          
          console.log(`[AddOrder] Comparing: "${normalizedNewOrderNo}" vs "${normalizedSysOrderNo}" = ${isMatch}`);

          if (isMatch) {
            console.log(`[AddOrder] Merging Un_Associated order ${sysOrder.orderNo} to new order ${order.orderNo}`);
            
            // 将匹配的Un_Associated订单下的所有收据转移到新订单
            await db.receipt.updateMany({
              where: { orderId: sysOrder.id },
              data: { orderId: order.id }
            });

            // 删除Un_Associated中的订单
            await db.order.delete({
              where: { id: sysOrder.id }
            });

            // 重新计算新订单的余额
            await updateOrderBalance(order.id);
          }
        }
      }

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
      
      if (!fromOrderId || !toOrderNo || transferAmount === undefined || transferAmount <= 0) {
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
      let toOrder = await db.order.findFirst({
        where: { orderNo: toOrderNo }
      });

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
            orderNo: toOrderNo,
            tokens: serializeOrderTokens(toOrderNo),
            amount: 0,  // Un_Associated 下的订单金额为0
            orderBalance: 0,
            createdBy: currentUser.id,
            needsCustomerFix: true,
          }
        });
        console.log(`[Transfer] Created new order in Un_Associated: ${toOrderNo}`);
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
          orderNo: toOrderNo,
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
        message: `成功转移 $${transferAmount.toFixed(2)} 到订单 ${toOrderNo}` 
      });
    }

    return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
  } catch (error) {
    console.error('Update order error:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}, '只有管理员和销售代表可以修改订单');
