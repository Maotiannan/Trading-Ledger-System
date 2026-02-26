import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ReceiptStatus, DetailStatus } from '@prisma/client';
import { recognizeDetail } from '@/lib/ocr';
import { findMatchingReceipt, ensureSystemPoolInvoice, updateOrderBalance, findOrCreateOrder } from '@/lib/matching';
import { tokenizeOrder, checkTokenMatch } from '@/lib/tokenizer';
import { withAuth } from '@/lib/route-auth';
import { saveUploadedImage, UploadValidationError } from '@/lib/upload';

// 获取付款明细列表
export const GET = withAuth(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') as DetailStatus | null;
    const search = searchParams.get('search') || '';
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const minAmount = searchParams.get('minAmount');
    const maxAmount = searchParams.get('maxAmount');

    const where: Record<string, unknown> = {};
    
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { items: { some: { orderNo: { contains: search } } } },
        { items: { some: { mark: { contains: search } } } }
      ];
    }
    if (dateFrom || dateTo) {
      where.createdAt = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {})
      };
    }
    if (minAmount || maxAmount) {
      where.totalAmount = {
        ...(minAmount ? { gte: Number(minAmount) } : {}),
        ...(maxAmount ? { lte: Number(maxAmount) } : {})
      };
    }

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
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const action = formData.get('action') as string;
    const detailId = formData.get('detailId') as string;

    if (action === 'recognize') {
      // AI识别付款明细
      if (!file) {
        return NextResponse.json({ success: false, error: '请上传图片' }, { status: 400 });
      }

      try {
        // 转换为base64
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const base64 = `data:${file.type};base64,${buffer.toString('base64')}`;

        // AI识别
        const ocrResult = await recognizeDetail(base64);

        // 为每一行尝试匹配RECEIPT
        const matchedItems = [];
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
        return NextResponse.json({ 
          success: false, 
          error: 'AI识别失败，请检查图片是否清晰' 
        }, { status: 500 });
      }
    }

    if (action === 'confirm') {
      // 确认创建付款明细
      const dataStr = formData.get('data') as string;
      const imagePath = formData.get('imagePath') as string;
      const imageName = formData.get('imageName') as string;
      
      console.log('[Detail Confirm] imagePath:', imagePath);
      console.log('[Detail Confirm] imageName:', imageName);
      
      if (!dataStr) {
        return NextResponse.json({ success: false, error: '缺少明细数据' }, { status: 400 });
      }

      const data = JSON.parse(dataStr);
      const { date, items } = data;

      // 处理每个item，确保有对应的ORDER和RECEIPT
      const processedItems = [];
      for (const item of items) {
        // 兼容两种字段名：receiptId 或 matchedReceiptId
        let receiptId = item.receiptId || item.matchedReceiptId;
        
        console.log(`Processing item: orderNo=${item.orderNo}, amount=${item.amount}, receiptId=${receiptId}`);
        
        // 如果没有匹配的Receipt，创建新的Order和Receipt
        if (!receiptId && item.orderNo) {
          // 使用分词匹配查找或创建Order
          console.log(`Creating/finding order for: ${item.orderNo}`);
          const orderId = await findOrCreateOrder(item.orderNo, currentUser.id);
          console.log(`Order ID: ${orderId}`);
          
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
              imageName: imageName
            }
          });
          
          receiptId = newReceipt.id;
          console.log(`Created receipt: ${receiptId}`);
          
          // 更新Order余额
          await updateOrderBalance(orderId);
        }
        
        processedItems.push({
          mark: item.mark,
          orderNo: item.orderNo,
          amount: item.amount,
          receiptId
        });
      }

      // 创建付款明细
      const detail = await db.detail.create({
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

      // 更新关联的RECEIPT状态
      for (const item of detail.items) {
        if (item.receiptId) {
          await db.receipt.update({
            where: { id: item.receiptId },
            data: { status: ReceiptStatus.Waiting_SWIFT }
          });
        }
      }

      return NextResponse.json({ success: true, data: detail });
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

      const dataStr = formData.get('data') as string;
      const imagePath = formData.get('imagePath') as string;
      const imageName = formData.get('imageName') as string;
      
      if (dataStr) {
        const data = JSON.parse(dataStr);
        const { date, items } = data;

        // 删除旧的明细项
        await db.detailItem.deleteMany({ where: { detailId } });

        // 处理每个item，确保有对应的ORDER和RECEIPT
        const processedItems = [];
        for (const item of items) {
          // 兼容两种字段名：receiptId 或 matchedReceiptId
          let receiptId = item.receiptId || item.matchedReceiptId;
          
          console.log(`[Update] Processing item: orderNo=${item.orderNo}, amount=${item.amount}, receiptId=${receiptId}`);
          
          // 如果没有匹配的Receipt，创建新的Order和Receipt
          if (!receiptId && item.orderNo) {
            // 使用分词匹配查找或创建Order
            console.log(`[Update] Creating/finding order for: ${item.orderNo}`);
            const orderId = await findOrCreateOrder(item.orderNo, currentUser.id);
            console.log(`[Update] Order ID: ${orderId}`);
            
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
                imageName: imageName || existingDetail.imageName
              }
            });
            
            receiptId = newReceipt.id;
            console.log(`[Update] Created receipt: ${receiptId}`);
            
            // 更新Order余额
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

        return NextResponse.json({ success: true, data: updated });
      }

      return NextResponse.json({ success: false, error: '缺少更新数据' }, { status: 400 });
    }

    return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
  } catch (error) {
    console.error('Detail API error:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
});
