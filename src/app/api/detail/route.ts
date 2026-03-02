import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ReceiptStatus, DetailStatus } from '@prisma/client';
import { recognizeDetail } from '@/lib/ocr';
import { findMatchingReceipt, updateOrderBalance, findOrCreateOrder } from '@/lib/matching';
import { withAuth } from '@/lib/route-auth';
import { saveUploadedImage, UploadValidationError } from '@/lib/upload';
import { canAccessOwnedResourceAsync, forbiddenOwnershipResponse } from '@/lib/ownership';
import { assertSearchLength, detailPayloadSchema, InputValidationError, parseJsonWithSchema } from '@/lib/validators';
import { recordAuditEvent } from '@/lib/audit';
import { parseActionRequest } from '@/lib/http-body';
import { resolveCustomer } from '@/lib/customer-matching';
import { toOcrDataUrl } from '@/lib/ocr-input';
import { getHierarchyScope } from '@/lib/user-hierarchy';

type DetailProcessedItem = {
  mark: string | null;
  orderNo: string | null;
  amount: number;
  receiptId: string | null;
};

async function resolveDetailItemCustomer(mark: string | null) {
  const normalized = typeof mark === 'string' ? mark.trim() : '';
  if (!normalized) {
    return {
      customerId: null,
      customerMark: null,
      customerName: null,
      customerPhone: null,
      customerCity: null,
      needsCustomerFix: true,
    };
  }
  const matched = await resolveCustomer({ customerMark: normalized });
  return {
    customerId: matched.customerId,
    customerMark: matched.customerMark,
    customerName: matched.customerName,
    customerPhone: matched.customerPhone,
    customerCity: matched.customerCity,
    needsCustomerFix: matched.needsCustomerFix,
  };
}

function parseDetailPayload(data: Record<string, unknown>) {
  if (typeof data.data === 'string') {
    return parseJsonWithSchema(data.data, detailPayloadSchema, '明细数据格式错误');
  }
  const result = detailPayloadSchema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new InputValidationError(issue?.message || '明细数据格式错误');
  }
  return result.data;
}

// 获取付款明细列表
export const GET = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') as DetailStatus | null;
    const search = searchParams.get('search') || '';
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const minAmount = searchParams.get('minAmount');
    const maxAmount = searchParams.get('maxAmount');

    const scope = await getHierarchyScope(currentUser);
    const ownerIds = Array.from(scope.ownerVisibleIds);
    const filters: Record<string, unknown>[] = [
      {
        OR: [
          { createdBy: { in: ownerIds } },
          { items: { some: { receipt: { customer: { createdBy: { in: ownerIds } } } } } },
        ],
      },
    ];

    if (status) filters.push({ status });
    if (search) {
      assertSearchLength(search);
      filters.push({
        OR: [
          { items: { some: { orderNo: { contains: search } } } },
          { items: { some: { mark: { contains: search } } } },
        ],
      });
    }
    if (dateFrom || dateTo) {
      filters.push({
        createdAt: {
          ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
          ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {})
        },
      });
    }
    if (minAmount || maxAmount) {
      filters.push({
        totalAmount: {
          ...(minAmount ? { gte: Number(minAmount) } : {}),
          ...(maxAmount ? { lte: Number(maxAmount) } : {})
        },
      });
    }
    const where = filters.length === 1 ? filters[0] : { AND: filters };

    const details = await db.detail.findMany({
      where,
      include: {
        creator: { select: { id: true, name: true, email: true } },
        items: {
          include: {
            receipt: true
          }
        },
        swift: true,
        histories: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json({ success: true, data: details });
  } catch (error) {
    console.error('Get details error:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
});

// 上传并识别付款明细
export const POST = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const { action, data: requestData, file } = await parseActionRequest(request);
    const detailId = (requestData.detailId as string) || '';

    if (action === 'recognize') {
      // AI识别付款明细
      if (!file) {
        return NextResponse.json({ success: false, error: '请上传图片' }, { status: 400 });
      }

      try {
        const base64 = await toOcrDataUrl(file);

        // AI识别
        const ocrResult = await recognizeDetail(base64);

        // 为每一行尝试匹配RECEIPT
        const matchedItems: Array<(typeof ocrResult.items)[number] & { matchedReceiptId: string | null }> = [];
        for (const item of ocrResult.items) {
          const matchedReceiptId = await findMatchingReceipt(item.orderNo, item.amount);
          matchedItems.push({
            ...item,
            matchedReceiptId
          });
        }

        // 保存图片临时路径
        const imagePath = await saveUploadedImage(file);

        return NextResponse.json({ 
          success: true, 
          data: { 
            ocrResult: { ...ocrResult, items: matchedItems }, 
            image: imagePath 
          } 
        });
      } catch (ocrError) {
        console.error('OCR recognition error:', ocrError);
        if (ocrError instanceof UploadValidationError) {
          return NextResponse.json({ success: false, error: ocrError.message }, { status: 400 });
        }
        const detail = ocrError instanceof Error ? ocrError.message : '未知错误';
        return NextResponse.json({ 
          success: false, 
          error: `AI识别失败：${detail}` 
        }, { status: 500 });
      }
    }

    if (action === 'confirm') {
      // 确认创建付款明细
      const imagePath = (requestData.imagePath as string) || '';
      const imageName = (requestData.imageName as string) || '';
      
      console.log('[Detail Confirm] imagePath:', imagePath);
      console.log('[Detail Confirm] imageName:', imageName);
      
      const detailPayload = parseDetailPayload(requestData);
      const { date } = detailPayload;
      const normalizedItems = detailPayload.items.map((item) => ({
        mark: item.mark,
        orderNo: item.orderNo,
        amount: item.amount,
        receiptId: item.receiptId || item.matchedReceiptId || null,
      }));

      // 处理每个item，确保有对应的ORDER和RECEIPT
      const processedItems: DetailProcessedItem[] = [];
      for (const item of normalizedItems) {
        // 兼容两种字段名：receiptId 或 matchedReceiptId
        let receiptId = item.receiptId;
        
        console.log(`Processing item: orderNo=${item.orderNo}, amount=${item.amount}, receiptId=${receiptId}`);
        if (receiptId) {
          const receipt = await db.receipt.findUnique({
            where: { id: receiptId },
            select: { createdBy: true, imageUrl: true, imageName: true },
          });
          if (!receipt) {
            return NextResponse.json({ success: false, error: '关联收据不存在' }, { status: 400 });
          }
          if (!(await canAccessOwnedResourceAsync(receipt.createdBy, currentUser))) {
            return forbiddenOwnershipResponse('无权关联该收据');
          }
          if (imagePath && !receipt.imageUrl) {
            await db.receipt.update({
              where: { id: receiptId },
              data: {
                imageUrl: imagePath,
                imageName: imageName || receipt.imageName,
              },
            });
          }
        }
        
        // 如果没有显式关联收据，先尝试按 AI 同规则自动匹配
        if (!receiptId && item.orderNo) {
          const autoMatchedReceiptId = await findMatchingReceipt(item.orderNo, item.amount);
          if (autoMatchedReceiptId) {
            const matchedReceipt = await db.receipt.findUnique({
              where: { id: autoMatchedReceiptId },
              select: { createdBy: true, imageUrl: true, imageName: true },
            });
            if (!matchedReceipt) {
              return NextResponse.json({ success: false, error: '关联收据不存在' }, { status: 400 });
            }
            if (!(await canAccessOwnedResourceAsync(matchedReceipt.createdBy, currentUser))) {
              return forbiddenOwnershipResponse('无权关联该收据');
            }
            receiptId = autoMatchedReceiptId;
            if (imagePath && !matchedReceipt.imageUrl) {
              await db.receipt.update({
                where: { id: autoMatchedReceiptId },
                data: {
                  imageUrl: imagePath,
                  imageName: imageName || matchedReceipt.imageName,
                },
              });
            }
          }
        }

        // 仍未匹配到时，创建新的Order和Receipt
        if (!receiptId && item.orderNo) {
          // 使用分词匹配查找或创建Order
          console.log(`Creating/finding order for: ${item.orderNo}`);
          const orderId = await findOrCreateOrder(item.orderNo, currentUser.id);
          console.log(`Order ID: ${orderId}`);
          const customerInfo = await resolveDetailItemCustomer(item.mark);
          
          // 创建新的Receipt，引用DETAIL的图片
          const newReceipt = await db.receipt.create({
            data: {
              orderNo: item.orderNo,
              usd: item.amount,
              status: ReceiptStatus.SR_Received,
              orderId,
              createdBy: currentUser.id,
              note: '由付款明细自动创建',
              imageUrl: imagePath,
              imageName: imageName,
              customerId: customerInfo.customerId,
              customerMark: customerInfo.customerMark,
              customerName: customerInfo.customerName,
              customerPhone: customerInfo.customerPhone,
              customerCity: customerInfo.customerCity,
              needsCustomerFix: customerInfo.needsCustomerFix,
            }
          });
          
          receiptId = newReceipt.id;
          console.log(`Created receipt: ${receiptId}`);
          
          // 更新Order余额
          await db.order.update({
            where: { id: orderId },
            data: {
              customerId: customerInfo.customerId,
              customerMark: customerInfo.customerMark,
              customerName: customerInfo.customerName,
              customerPhone: customerInfo.customerPhone,
              customerCity: customerInfo.customerCity,
              needsCustomerFix: customerInfo.needsCustomerFix,
            },
          });
          await updateOrderBalance(orderId);
        }
        
        processedItems.push({
          mark: item.mark,
          orderNo: item.orderNo,
          amount: item.amount,
          receiptId
        });
      }

      // 创建明细并更新收据状态，保证一致性
      const detail = await db.$transaction(async (tx) => {
        const created = await tx.detail.create({
          data: {
            date: date ? new Date(date) : null,
            status: DetailStatus.Waiting_SWIFT,
            imageUrl: imagePath,
            imageName,
            totalAmount: processedItems.reduce((sum, item) => sum + item.amount, 0),
            createdBy: currentUser.id,
            items: {
              create: processedItems
            }
          },
          include: {
            items: { include: { receipt: true } },
            creator: { select: { id: true, name: true, email: true } }
          }
        });

        for (const item of created.items) {
          if (item.receiptId) {
            await tx.receipt.update({
              where: { id: item.receiptId },
              data: { status: ReceiptStatus.Waiting_SWIFT }
            });
          }
        }

        return created;
      });
      await recordAuditEvent({
        action: 'DETAIL_CREATE',
        actorId: currentUser.id,
        targetType: 'DETAIL',
        targetId: detail.id,
      });

      return NextResponse.json({ success: true, data: detail });
    }

    if (action === 'direct-create') {
      const detailPayload = parseDetailPayload(requestData);
      const { date } = detailPayload;
      const normalizedItems = detailPayload.items.map((item) => ({
        mark: item.mark,
        orderNo: item.orderNo,
        amount: item.amount,
        receiptId: item.receiptId || item.matchedReceiptId || null,
      }));

      const processedItems: DetailProcessedItem[] = [];
      for (const item of normalizedItems) {
        let receiptId = item.receiptId;
        if (receiptId) {
          const receipt = await db.receipt.findUnique({ where: { id: receiptId }, select: { createdBy: true } });
          if (!receipt) {
            return NextResponse.json({ success: false, error: '关联收据不存在' }, { status: 400 });
          }
          if (!(await canAccessOwnedResourceAsync(receipt.createdBy, currentUser))) {
            return forbiddenOwnershipResponse('无权关联该收据');
          }
        }

        if (!receiptId && item.orderNo) {
          const autoMatchedReceiptId = await findMatchingReceipt(item.orderNo, item.amount);
          if (autoMatchedReceiptId) {
            const matchedReceipt = await db.receipt.findUnique({
              where: { id: autoMatchedReceiptId },
              select: { createdBy: true },
            });
            if (!matchedReceipt) {
              return NextResponse.json({ success: false, error: '关联收据不存在' }, { status: 400 });
            }
            if (!(await canAccessOwnedResourceAsync(matchedReceipt.createdBy, currentUser))) {
              return forbiddenOwnershipResponse('无权关联该收据');
            }
            receiptId = autoMatchedReceiptId;
          }
        }

        if (!receiptId && item.orderNo) {
          const orderId = await findOrCreateOrder(item.orderNo, currentUser.id);
          const customerInfo = await resolveDetailItemCustomer(item.mark);
          const newReceipt = await db.receipt.create({
            data: {
              orderNo: item.orderNo,
              usd: item.amount,
              status: ReceiptStatus.SR_Received,
              orderId,
              createdBy: currentUser.id,
              note: '由付款明细直接创建',
              customerId: customerInfo.customerId,
              customerMark: customerInfo.customerMark,
              customerName: customerInfo.customerName,
              customerPhone: customerInfo.customerPhone,
              customerCity: customerInfo.customerCity,
              needsCustomerFix: customerInfo.needsCustomerFix,
            }
          });
          receiptId = newReceipt.id;
          await db.order.update({
            where: { id: orderId },
            data: {
              customerId: customerInfo.customerId,
              customerMark: customerInfo.customerMark,
              customerName: customerInfo.customerName,
              customerPhone: customerInfo.customerPhone,
              customerCity: customerInfo.customerCity,
              needsCustomerFix: customerInfo.needsCustomerFix,
            },
          });
          await updateOrderBalance(orderId);
        }

        processedItems.push({
          mark: item.mark,
          orderNo: item.orderNo,
          amount: item.amount,
          receiptId
        });
      }

      const detail = await db.$transaction(async (tx) => {
        const created = await tx.detail.create({
          data: {
            date: date ? new Date(date) : null,
            status: DetailStatus.Waiting_SWIFT,
            imageUrl: null,
            imageName: null,
            totalAmount: processedItems.reduce((sum, item) => sum + item.amount, 0),
            createdBy: currentUser.id,
            items: {
              create: processedItems
            }
          },
          include: {
            items: { include: { receipt: true } },
            creator: { select: { id: true, name: true, email: true } }
          }
        });

        for (const item of created.items) {
          if (item.receiptId) {
            await tx.receipt.update({
              where: { id: item.receiptId },
              data: { status: ReceiptStatus.Waiting_SWIFT }
            });
          }
        }

        return created;
      });

      await recordAuditEvent({
        action: 'DETAIL_CREATE_DIRECT',
        actorId: currentUser.id,
        targetType: 'DETAIL',
        targetId: detail.id,
      });

      return NextResponse.json({ success: true, data: detail, message: '付款明细已直接创建' });
    }

    if (action === 'update') {
      // 更新付款明细（重新识别）
      if (!detailId) {
        return NextResponse.json({ success: false, error: '缺少明细ID' }, { status: 400 });
      }

      const existingDetail = await db.detail.findUnique({
        where: { id: detailId },
        include: { items: true }
      });

      if (!existingDetail) {
        return NextResponse.json({ success: false, error: '明细不存在' }, { status: 400 });
      }
      if (!(await canAccessOwnedResourceAsync(existingDetail.createdBy, currentUser))) {
        return forbiddenOwnershipResponse('无权修改该明细');
      }

      // 检查状态
      if (existingDetail.status === DetailStatus.RECEIVED) {
        return NextResponse.json({ success: false, error: 'RECEIVED状态下禁止修改' }, { status: 400 });
      }

      if (existingDetail.status === DetailStatus.Bank_Transfer) {
        return NextResponse.json({ success: false, error: 'Bank_Transfer状态下禁止修改' }, { status: 400 });
      }

      // 保存历史记录
      await db.detailHistory.create({
        data: {
          detailId,
          date: existingDetail.date,
          items: JSON.stringify(existingDetail.items),
          imageUrl: existingDetail.imageUrl,
          imageName: existingDetail.imageName,
          status: existingDetail.status,
          note: '重新识别前保存',
          createdBy: currentUser.id
        }
      });

      const dataStr = requestData.data as string;
      const imagePath = requestData.imagePath as string;
      const imageName = requestData.imageName as string;
      
      if (dataStr) {
        const data = parseJsonWithSchema(dataStr, detailPayloadSchema, '明细数据格式错误');
        const { date } = data;
        const normalizedItems = data.items.map((item) => ({
          mark: item.mark,
          orderNo: item.orderNo,
          amount: item.amount,
          receiptId: item.receiptId || item.matchedReceiptId || null,
        }));

        // 删除旧的明细项
        await db.detailItem.deleteMany({ where: { detailId } });

        // 处理每个item，确保有对应的ORDER和RECEIPT
        const processedItems: DetailProcessedItem[] = [];
        for (const item of normalizedItems) {
          // 兼容两种字段名：receiptId 或 matchedReceiptId
          let receiptId = item.receiptId;
          
          console.log(`[Update] Processing item: orderNo=${item.orderNo}, amount=${item.amount}, receiptId=${receiptId}`);
          if (receiptId) {
            const receipt = await db.receipt.findUnique({ where: { id: receiptId }, select: { createdBy: true } });
            if (!receipt) {
              return NextResponse.json({ success: false, error: '关联收据不存在' }, { status: 400 });
            }
            if (!(await canAccessOwnedResourceAsync(receipt.createdBy, currentUser))) {
              return forbiddenOwnershipResponse('无权关联该收据');
            }
          }
          
          // 如果没有显式关联收据，先尝试按 AI 同规则自动匹配
          if (!receiptId && item.orderNo) {
            const autoMatchedReceiptId = await findMatchingReceipt(item.orderNo, item.amount);
            if (autoMatchedReceiptId) {
              const matchedReceipt = await db.receipt.findUnique({
                where: { id: autoMatchedReceiptId },
                select: { createdBy: true },
              });
              if (!matchedReceipt) {
                return NextResponse.json({ success: false, error: '关联收据不存在' }, { status: 400 });
              }
              if (!(await canAccessOwnedResourceAsync(matchedReceipt.createdBy, currentUser))) {
                return forbiddenOwnershipResponse('无权关联该收据');
              }
              receiptId = autoMatchedReceiptId;
            }
          }

          // 仍未匹配到时，创建新的Order和Receipt
          if (!receiptId && item.orderNo) {
            // 使用分词匹配查找或创建Order
            console.log(`[Update] Creating/finding order for: ${item.orderNo}`);
            const orderId = await findOrCreateOrder(item.orderNo, currentUser.id);
            console.log(`[Update] Order ID: ${orderId}`);
            const customerInfo = await resolveDetailItemCustomer(item.mark);
            
            // 创建新的Receipt，引用DETAIL的图片
            const newReceipt = await db.receipt.create({
              data: {
                orderNo: item.orderNo,
                usd: item.amount,
                status: ReceiptStatus.SR_Received,
                orderId,
                createdBy: currentUser.id,
                note: '由付款明细自动创建',
                imageUrl: imagePath || existingDetail.imageUrl,
                imageName: imageName || existingDetail.imageName,
                customerId: customerInfo.customerId,
                customerMark: customerInfo.customerMark,
                customerName: customerInfo.customerName,
                customerPhone: customerInfo.customerPhone,
                customerCity: customerInfo.customerCity,
                needsCustomerFix: customerInfo.needsCustomerFix,
              }
            });
            
            receiptId = newReceipt.id;
            console.log(`[Update] Created receipt: ${receiptId}`);
            
            // 更新Order余额
            await db.order.update({
              where: { id: orderId },
              data: {
                customerId: customerInfo.customerId,
                customerMark: customerInfo.customerMark,
                customerName: customerInfo.customerName,
                customerPhone: customerInfo.customerPhone,
                customerCity: customerInfo.customerCity,
                needsCustomerFix: customerInfo.needsCustomerFix,
              },
            });
            await updateOrderBalance(orderId);
          }
          
          processedItems.push({
            mark: item.mark,
            orderNo: item.orderNo,
            amount: item.amount,
            receiptId
          });
        }

        // 更新明细
        const updated = await db.detail.update({
          where: { id: detailId },
          data: {
            date: date ? new Date(date) : null,
            imageUrl: imagePath || existingDetail.imageUrl,
            imageName: imageName || existingDetail.imageName,
            totalAmount: processedItems.reduce((sum, item) => sum + item.amount, 0),
            items: {
              create: processedItems
            }
          },
          include: {
            items: { include: { receipt: true } }
          }
        });

        // 更新关联的RECEIPT状态
        for (const item of updated.items) {
          if (item.receiptId) {
            await db.receipt.update({
              where: { id: item.receiptId },
              data: { status: ReceiptStatus.Waiting_SWIFT }
            });
          }
        }
        await recordAuditEvent({
          action: 'DETAIL_UPDATE',
          actorId: currentUser.id,
          targetType: 'DETAIL',
          targetId: detailId,
        });

        return NextResponse.json({ success: true, data: updated });
      }

      return NextResponse.json({ success: false, error: '缺少更新数据' }, { status: 400 });
    }

    return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
  } catch (error) {
    console.error('Detail API error:', error);
    if (error instanceof UploadValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    if (error instanceof InputValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
});
