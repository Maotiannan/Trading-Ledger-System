import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { UserRole } from '@prisma/client';
import { updateOrderBalance } from '@/lib/matching';
import { withAuth, withRole } from '@/lib/route-auth';
import { serializeOrderTokens } from '@/lib/tokenizer';

// 获取账单列表
export const GET = withAuth(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';

    const invoices = await db.invoice.findMany({
      where: search ? {
        invNo: { contains: search }
      } : undefined,
      include: {
        orders: {
          include: {
            receipts: {
              where: { orderId: { not: null } },
              select: { usd: true, status: true }
            }
          }
        },
        creator: { select: { id: true, name: true, email: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    // 计算每个账单的总金额和余额
    const result = invoices.map(invoice => {
      const isUnAssociated = invoice.invNo === 'Un_Associated';
      
      // Un_Associated 账单的总金额为0，余额为所有收据金额的负数
      const invAmount = isUnAssociated ? 0 : invoice.orders.reduce((sum, order) => sum + order.amount, 0);
      const receivedAmount = invoice.orders.reduce((sum, order) => {
        return sum + order.receipts.reduce((s, r) => s + r.usd, 0);
      }, 0);
      const invBalance = isUnAssociated ? -receivedAmount : invAmount - receivedAmount;

      return {
        ...invoice,
        invAmount,
        invBalance,
        orders: invoice.orders.map(order => {
          const orderReceived = order.receipts.reduce((s, r) => s + r.usd, 0);
          
          // Un_Associated 下的订单：金额显示为0（前端显示"-"），余额为收据金额的负数
          if (isUnAssociated) {
            return {
              ...order,
              amount: 0, // 前端会显示为 "-"
              orderBalance: -orderReceived, // 负数表示多付
              isSystemOrder: true
            };
          }
          
          return {
            ...order,
            orderBalance: order.amount - orderReceived,
            isSystemOrder: false
          };
        })
      };
    });

    // 排序：Un_Associated 置顶，其他按创建时间倒序
    result.sort((a, b) => {
      if (a.invNo === 'Un_Associated') return -1;
      if (b.invNo === 'Un_Associated') return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('Get invoices error:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
});

// 创建账单
export const POST = withRole(UserRole.ADMIN, async (request: NextRequest, currentUser) => {
  try {
    const body = await request.json();
    const { invNo, orders } = body;

    if (!invNo || !orders || !Array.isArray(orders) || orders.length === 0) {
      return NextResponse.json({ success: false, error: '账单号和订单列表不能为空' }, { status: 400 });
    }

    // 检查账单号是否已存在
    const existing = await db.invoice.findUnique({ where: { invNo } });
    if (existing) {
      return NextResponse.json({ success: false, error: '账单号已存在' }, { status: 400 });
    }

    // 处理订单：检查是否有已存在的订单
    const processedOrders: { orderNo: string; amount: number; existingOrderId?: string }[] = [];
    const mergedOrdersInfo: string[] = [];

    for (const order of orders) {
      // 检查系统中是否已存在相同订单号
      const existingOrder = await db.order.findFirst({
        where: {
          orderNo: {
            equals: order.orderNo,
            mode: 'insensitive'
          }
        },
        include: { invoice: true }
      });

      if (existingOrder) {
        // 如果已存在，增加金额到现有订单
        await db.order.update({
          where: { id: existingOrder.id },
          data: {
            amount: { increment: order.amount },
            orderBalance: { increment: order.amount }
          }
        });
        mergedOrdersInfo.push(`${order.orderNo} (合并到账单 ${existingOrder.invoice.invNo})`);
        console.log(`[Invoice Create] Merged order ${order.orderNo} to existing in invoice ${existingOrder.invoice.invNo}`);
      } else {
        processedOrders.push({ orderNo: order.orderNo, amount: order.amount });
      }
    }

    // 如果所有订单都被合并了，不创建新账单
    if (processedOrders.length === 0) {
      return NextResponse.json({ 
        success: true, 
        message: `所有订单已合并到现有账单: ${mergedOrdersInfo.join(', ')}`,
        merged: true
      });
    }

    // 创建账单（只包含未合并的订单）
    const invoice = await db.invoice.create({
      data: {
        invNo,
        createdBy: currentUser.id,
        orders: {
          create: processedOrders.map(order => ({
            orderNo: order.orderNo,
            tokens: serializeOrderTokens(order.orderNo),
            amount: order.amount,
            orderBalance: order.amount
          }))
        }
      },
      include: {
        orders: true
      }
    });

    // 合并匹配的自动创建的订单（从Un_Associated）
    const systemPool = await db.invoice.findFirst({
      where: { invNo: 'Un_Associated' }
    });

    console.log('[Invoice Create] Checking for Un_Associated:', systemPool?.id);

    if (systemPool) {
      for (const newOrder of invoice.orders) {
        console.log(`[Invoice Create] Checking order: ${newOrder.orderNo}`);
        
        // 查找Un_Associated中匹配的订单（ORDER名称匹配，不区分大小写）
        const systemOrders = await db.order.findMany({
          where: { invoiceId: systemPool.id }
        });

        console.log(`[Invoice Create] Found ${systemOrders.length} system orders to check`);

        const normalizedNewOrderNo = newOrder.orderNo.toLowerCase().trim();
        
        for (const sysOrder of systemOrders) {
          const normalizedSysOrderNo = sysOrder.orderNo.toLowerCase().trim();
          
          // 检查是否匹配（双向包含或相等）
          const isMatch = normalizedNewOrderNo === normalizedSysOrderNo ||
                          normalizedNewOrderNo.includes(normalizedSysOrderNo) ||
                          normalizedSysOrderNo.includes(normalizedNewOrderNo);
          
          console.log(`[Invoice Create] Comparing: "${normalizedNewOrderNo}" vs "${normalizedSysOrderNo}" = ${isMatch}`);

          if (isMatch) {
            console.log(`[Invoice Create] Merging Un_Associated order ${sysOrder.orderNo} to invoice order ${newOrder.orderNo}`);
            
            // 检查系统订单下是否有收据
            const sysReceipts = await db.receipt.findMany({
              where: { orderId: sysOrder.id }
            });
            console.log(`[Invoice Create] Un_Associated order has ${sysReceipts.length} receipts`);

            // 将匹配的Un_Associated订单下的所有收据转移到新订单
            await db.receipt.updateMany({
              where: { orderId: sysOrder.id },
              data: { orderId: newOrder.id }
            });

            // 删除Un_Associated中的订单
            await db.order.delete({
              where: { id: sysOrder.id }
            });

            console.log(`[Invoice Create] Deleted Un_Associated order ${sysOrder.id}`);

            // 重新计算新订单的余额
            await updateOrderBalance(newOrder.id);
          }
        }
      }
    }

    // 合并定金记录
    for (const order of invoice.orders) {
      // SQLite 不支持 mode: 'insensitive'，需要手动过滤
      const allDeposits = await db.receipt.findMany({
        where: {
          isDeposit: true,
          isMerged: false
        }
      });

      const normalizedOrderNo = order.orderNo.toLowerCase();
      const deposits = allDeposits.filter(d => 
        d.orderNo && d.orderNo.toLowerCase().includes(normalizedOrderNo)
      );

      for (const deposit of deposits) {
        // 将定金合并到正式账单
        await db.receipt.update({
          where: { id: deposit.id },
          data: {
            orderId: order.id,
            isMerged: true
          }
        });

        // 更新订单余额
        await updateOrderBalance(order.id);
      }
    }

    const message = mergedOrdersInfo.length > 0 
      ? `账单创建成功，部分订单已合并: ${mergedOrdersInfo.join(', ')}`
      : undefined;

    return NextResponse.json({ success: true, data: invoice, message });
  } catch (error) {
    console.error('Create invoice error:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}, '只有管理员可以创建账单');

// 删除账单
export const DELETE = withRole(UserRole.ADMIN, async (request: NextRequest) => {
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
}, '只有管理员可以删除账单');

// 重新匹配所有订单
async function rematchAllOrders() {
  console.log('[Rematch] Starting rematch all orders...');
  
  // 获取所有订单
  const allOrders = await db.order.findMany({
    include: {
      invoice: true,
      receipts: true
    }
  });

  let mergedCount = 0;

  // 按订单号分组，找出重复的订单
  const orderGroups = new Map<string, typeof allOrders>();
  
  for (const order of allOrders) {
    const normalizedOrderNo = order.orderNo.toLowerCase().trim();
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

  // 重新匹配收据到订单
  const allReceipts = await db.receipt.findMany({
    where: {
      orderId: null,
      orderNo: { not: null }
    }
  });

  console.log(`[Rematch] Found ${allReceipts.length} unmatched receipts with orderNo`);

  for (const receipt of allReceipts) {
    if (!receipt.orderNo) continue;
    
    const normalizedOrderNo = receipt.orderNo.toLowerCase().trim();
    
    // 查找匹配的订单
    const matchingOrder = await db.order.findFirst({
      where: {
        orderNo: {
          contains: normalizedOrderNo
        }
      }
    });

    if (matchingOrder) {
      // 检查订单号是否匹配（双向包含）
      const orderNoLower = matchingOrder.orderNo.toLowerCase();
      if (orderNoLower.includes(normalizedOrderNo) || normalizedOrderNo.includes(orderNoLower)) {
        await db.receipt.update({
          where: { id: receipt.id },
          data: { orderId: matchingOrder.id }
        });
        
        await updateOrderBalance(matchingOrder.id);
        console.log(`[Rematch] Matched receipt ${receipt.id} to order ${matchingOrder.orderNo}`);
      }
    }
  }

  console.log(`[Rematch] Completed. Merged ${mergedCount} orders.`);
  return { mergedCount };
}

// 更新订单
export const PUT = withRole(UserRole.ADMIN, async (request: NextRequest, currentUser) => {
  try {
    const body = await request.json();
    const { action, orderId, orderNo, amount, invoiceId } = body;

    // 刷新匹配
    if (action === 'rematch') {
      const result = await rematchAllOrders();
      return NextResponse.json({ 
        success: true, 
        message: `重新匹配完成，合并了 ${result.mergedCount} 个重复订单` 
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

      const updated = await db.order.update({
        where: { id: orderId },
        data: {
          orderNo: orderNo !== undefined ? orderNo : order.orderNo,
          tokens: orderNo !== undefined ? serializeOrderTokens(orderNo) : order.tokens,
          amount: amount !== undefined ? amount : order.amount,
        }
      });

      // 重新计算订单余额
      await updateOrderBalance(orderId);

      // 如果订单号有变化，触发重新匹配
      if (orderNo !== undefined && orderNo !== order.orderNo) {
        console.log(`[UpdateOrder] OrderNo changed from "${order.orderNo}" to "${orderNo}", triggering rematch...`);
        await rematchAllOrders();
      }

      return NextResponse.json({ success: true, data: updated });
    }

    // 添加订单到账单
    if (action === 'addOrder') {
      if (!invoiceId || !orderNo || amount === undefined) {
        return NextResponse.json({ success: false, error: '缺少必要参数' }, { status: 400 });
      }

      // 先检查是否已存在相同订单号的订单
      const existingOrder = await db.order.findFirst({
        where: {
          orderNo: {
            equals: orderNo,
            mode: 'insensitive'
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
            orderBalance: { increment: amount }
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
          orderBalance: amount
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

      await db.order.delete({ where: { id: orderId } });
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
      const fromReceived = fromReceipts.reduce((sum, r) => sum + r.usd, 0);
      const fromBalance = fromOrder.amount - fromReceived;

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
            orderBalance: 0
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
}, '只有管理员可以修改订单');
