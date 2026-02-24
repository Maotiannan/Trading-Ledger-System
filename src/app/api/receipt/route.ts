import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ReceiptStatus } from '@prisma/client';
import { recognizeReceipt } from '@/lib/ocr';
import { findMatchingOrder, updateOrderBalance } from '@/lib/matching';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

// 获取当前用户
async function getCurrentUser(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  if (!userId) return null;
  
  return db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true }
  });
}

// 保存图片
async function saveImage(file: File): Promise<{ path: string; name: string }> {
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  
  const uploadDir = path.join(process.cwd(), 'upload', 'images');
  await mkdir(uploadDir, { recursive: true });
  
  const fileName = `${Date.now()}_${file.name}`;
  const filePath = path.join(uploadDir, fileName);
  
  await writeFile(filePath, buffer);
  
  return { path: `/upload/images/${fileName}`, name: file.name };
}

// 获取收据列表
export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') as ReceiptStatus | null;
    const search = searchParams.get('search') || '';
    const orderId = searchParams.get('orderId');

    const where: Record<string, unknown> = {};
    
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { receiptNo: { contains: search } },
        { orderNo: { contains: search } },
        { invNo: { contains: search } },
        { payer: { contains: search } }
      ];
    }
    if (orderId) where.orderId = orderId;

    const receipts = await db.receipt.findMany({
      where,
      include: {
        creator: { select: { id: true, name: true, email: true } },
        order: true,
        histories: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json({ success: true, data: receipts });
  } catch (error) {
    console.error('Get receipts error:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}

// 解析请求体（支持JSON和FormData）
async function parseRequestBody(request: NextRequest): Promise<{ action: string; data: Record<string, unknown>; file?: File }> {
  const contentType = request.headers.get('content-type') || '';
  console.log('[parseRequestBody] Content-Type:', contentType);
  
  if (contentType.includes('application/json')) {
    console.log('[parseRequestBody] Parsing as JSON');
    const body = await request.json();
    return { 
      action: body.action || '', 
      data: body,
      file: undefined
    };
  } else if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
    console.log('[parseRequestBody] Parsing as FormData');
    const formData = await request.formData();
    const result: { action: string; data: Record<string, unknown>; file?: File } = {
      action: (formData.get('action') as string) || '',
      data: {}
    };
    
    // 提取所有非文件字段
    formData.forEach((value, key) => {
      if (key !== 'file' && typeof value === 'string') {
        result.data[key] = value;
      }
    });
    
    // 提取文件
    const file = formData.get('file');
    if (file && file instanceof File) {
      result.file = file;
    }
    
    return result;
  } else {
    // 尝试作为JSON解析（可能是没有正确设置Content-Type的情况）
    console.log('[parseRequestBody] Unknown content type, trying JSON');
    try {
      const body = await request.json();
      return { 
        action: body.action || '', 
        data: body,
        file: undefined
      };
    } catch {
      console.log('[parseRequestBody] JSON parse failed, trying FormData');
      try {
        const formData = await request.formData();
        const result: { action: string; data: Record<string, unknown>; file?: File } = {
          action: (formData.get('action') as string) || '',
          data: {}
        };
        
        formData.forEach((value, key) => {
          if (key !== 'file' && typeof value === 'string') {
            result.data[key] = value;
          }
        });
        
        const file = formData.get('file');
        if (file && file instanceof File) {
          result.file = file;
        }
        
        return result;
      } catch (formDataError) {
        console.error('[parseRequestBody] FormData parse also failed:', formDataError);
        return { action: '', data: {}, file: undefined };
      }
    }
  }
}

// 上传并识别收据
export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const { action, data, file } = await parseRequestBody(request);
    const receiptId = data.receiptId as string | undefined;

    if (action === 'recognize') {
      // AI识别收据
      if (!file) {
        return NextResponse.json({ success: false, error: '请上传图片' }, { status: 400 });
      }

      try {
        // 转换为base64
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const base64 = `data:${file.type};base64,${buffer.toString('base64')}`;

        // AI识别
        const ocrResult = await recognizeReceipt(base64);

        // 保存图片临时路径
        const imagePath = await saveImage(file);

        return NextResponse.json({ 
          success: true, 
          data: { 
            ocrResult, 
            image: imagePath 
          } 
        });
      } catch (ocrError) {
        console.error('OCR recognition error:', ocrError);
        return NextResponse.json({ 
          success: false, 
          error: 'AI识别失败，请检查图片是否清晰' 
        }, { status: 500 });
      }
    }

    if (action === 'confirm') {
      // 确认创建收据
      const dataStr = data.data as string;
      const imagePath = data.imagePath as string;
      const imageName = data.imageName as string;
      
      if (!dataStr) {
        return NextResponse.json({ success: false, error: '缺少收据数据' }, { status: 400 });
      }

      const receiptData = JSON.parse(dataStr);
      const { receiptNo, date, tel, usd, invNo, orderNo, payer, isDeposit } = receiptData;

      if (usd === null || usd === undefined || usd < 0) {
        return NextResponse.json({ success: false, error: '付款金额无效' }, { status: 400 });
      }

      if (receiptData.receiptNo && receiptData.receiptNo.trim()) {
        const existingReceipt = await db.receipt.findFirst({
          where: { 
            receiptNo: receiptNo.trim()
          }
        });
        if (existingReceipt) {
          return NextResponse.json({ 
            success: false, 
            error: `收据号 "${receiptData.receiptNo}" 已存在，请检查是否重复录入` 
          }, { status: 400 });
        }
      }

      // 查找匹配的ORDER
      const matchedOrder = await findMatchingOrder(receiptData.orderNo);

      let orderId: string | null = matchedOrder?.orderId || null;

      // 如果是定金，需要创建一个独立的订单记录
      if (receiptData.isDeposit && receiptData.orderNo && !matchedOrder) {
        // 查找或创建一个默认发票来存放定金订单
        let defaultInvoice = await db.invoice.findFirst({
          where: { invNo: 'DEPOSIT_POOL' }
        });
        
        if (!defaultInvoice) {
          defaultInvoice = await db.invoice.create({
            data: {
              invNo: 'DEPOSIT_POOL',
              createdBy: currentUser.id
            }
          });
        }

        const depositOrder = await db.order.create({
          data: {
            invoiceId: defaultInvoice.id,
            orderNo: receiptData.orderNo,
            amount: 0,
            orderBalance: -receiptData.usd
          }
        });

        orderId = depositOrder.id;
      }

      // 创建收据
      const receipt = await db.receipt.create({
        data: {
          receiptNo: receiptData.receiptNo?.trim() || null,
          date: receiptData.date ? new Date(receiptData.date) : null,
          tel: receiptData.tel,
          usd: receiptData.usd,
          invNo: receiptData.invNo,
          orderNo: receiptData.orderNo,
          payer: receiptData.payer,
          isDeposit: receiptData.isDeposit || false,
          status: ReceiptStatus.SR_Received,
          imageUrl: imagePath,
          imageName,
          orderId: orderId,
          createdBy: currentUser.id
        },
        include: {
          creator: { select: { id: true, name: true, email: true } }
        }
      });

      // 更新订单余额
      if (orderId) {
        await updateOrderBalance(orderId);
      }

      return NextResponse.json({ success: true, data: receipt });
    }

    if (action === 'update') {
      // 更新收据（重新识别）
      if (!receiptId) {
        return NextResponse.json({ success: false, error: '缺少收据ID' }, { status: 400 });
      }

      const existingReceipt = await db.receipt.findUnique({
        where: { id: receiptId }
      });

      if (!existingReceipt) {
        return NextResponse.json({ success: false, error: '收据不存在' }, { status: 400 });
      }

      // 检查状态
      if (existingReceipt.status === ReceiptStatus.RECEIVED) {
        return NextResponse.json({ success: false, error: 'RECEIVED状态下禁止修改' }, { status: 400 });
      }

      if (existingReceipt.status === ReceiptStatus.Bank_Transfer) {
        return NextResponse.json({ success: false, error: 'Bank_Transfer状态下禁止修改' }, { status: 400 });
      }

      // 保存历史记录
      await db.receiptHistory.create({
        data: {
          receiptId,
          receiptNo: existingReceipt.receiptNo,
          date: existingReceipt.date,
          tel: existingReceipt.tel,
          usd: existingReceipt.usd,
          invNo: existingReceipt.invNo,
          orderNo: existingReceipt.orderNo,
          payer: existingReceipt.payer,
          imageUrl: existingReceipt.imageUrl,
          imageName: existingReceipt.imageName,
          status: existingReceipt.status,
          note: '重新识别前保存',
          createdBy: currentUser.id
        }
      });

      const updateDataStr = data.data as string;
      const updateImagePath = data.imagePath as string;
      const updateImageName = data.imageName as string;
      
      if (updateDataStr) {
        const updateData = JSON.parse(updateDataStr);
        const { receiptNo, date, tel, usd, invNo, orderNo, payer, isDeposit } = updateData;

        // 查找匹配的ORDER
        const matchedOrder = await findMatchingOrder(orderNo);

        // 更新收据
        const updated = await db.receipt.update({
          where: { id: receiptId },
          data: {
            receiptNo,
            date: date ? new Date(date) : null,
            tel,
            usd,
            invNo,
            orderNo,
            payer,
            isDeposit: isDeposit || false,
            imageUrl: updateImagePath || existingReceipt.imageUrl,
            imageName: updateImageName || existingReceipt.imageName,
            orderId: matchedOrder?.orderId || existingReceipt.orderId
          }
        });

        // 更新订单余额
        if (existingReceipt.orderId) {
          await updateOrderBalance(existingReceipt.orderId);
        }
        if (matchedOrder && matchedOrder.orderId !== existingReceipt.orderId) {
          await updateOrderBalance(matchedOrder.orderId);
        }

        return NextResponse.json({ success: true, data: updated });
      }

      return NextResponse.json({ success: false, error: '缺少更新数据' }, { status: 400 });
    }

    if (action === 'mark-received') {
      // 标记为已签收（管理员）
      if (currentUser.role !== 'ADMIN') {
        return NextResponse.json({ success: false, error: '只有管理员可以标记签收' }, { status: 403 });
      }

      if (!receiptId) {
        return NextResponse.json({ success: false, error: '缺少收据ID' }, { status: 400 });
      }

      const existingReceipt = await db.receipt.findUnique({
        where: { id: receiptId }
      });

      if (!existingReceipt) {
        return NextResponse.json({ success: false, error: '收据不存在' }, { status: 400 });
      }

      if (existingReceipt.status !== ReceiptStatus.Bank_Transfer) {
        return NextResponse.json({ success: false, error: '必须在Bank_Transfer状态后才能标记签收' }, { status: 400 });
      }

      const updated = await db.receipt.update({
        where: { id: receiptId },
        data: { status: ReceiptStatus.RECEIVED }
      });

      // 检查关联的DETAIL是否所有RECEIPT都已签收
      const detailItems = await db.detailItem.findMany({
        where: { receiptId },
        include: { detail: { include: { items: { include: { receipt: true } } } } }
      });

      for (const item of detailItems) {
        if (item.detail) {
          const allReceived = item.detail.items.every(
            i => !i.receipt || i.receipt.status === ReceiptStatus.RECEIVED
          );
          if (allReceived) {
            await db.detail.update({
              where: { id: item.detail.id },
              data: { status: 'RECEIVED' }
            });
          }
        }
      }

      return NextResponse.json({ success: true, data: updated });
    }

    return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
  } catch (error) {
    console.error('Receipt API error:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
