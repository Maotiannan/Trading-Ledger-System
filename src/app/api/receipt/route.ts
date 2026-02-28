import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ReceiptStatus, UserRole } from '@prisma/client';
import { recognizeReceipt } from '@/lib/ocr';
import { findMatchingOrder, updateOrderBalance } from '@/lib/matching';
import { withAuth } from '@/lib/route-auth';
import { saveUploadedImage, UploadValidationError } from '@/lib/upload';
import { canAccessOwnedResource, forbiddenOwnershipResponse, isAdmin } from '@/lib/ownership';
import { assertSearchLength, InputValidationError, parseJsonWithSchema, receiptPayloadSchema } from '@/lib/validators';
import { recordAuditEvent } from '@/lib/audit';
import { parseActionRequest } from '@/lib/http-body';
import { resolveCustomer } from '@/lib/customer-matching';

function parseReceiptPayload(data: Record<string, unknown>) {
  if (typeof data.data === 'string') {
    return parseJsonWithSchema(data.data, receiptPayloadSchema, '收据数据格式错误');
  }
  const result = receiptPayloadSchema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new InputValidationError(issue?.message || '收据数据格式错误');
  }
  return result.data;
}

// 获取收据列表
export const GET = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') as ReceiptStatus | null;
    const search = searchParams.get('search') || '';
    const orderId = searchParams.get('orderId');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const minUsd = searchParams.get('minUsd');
    const maxUsd = searchParams.get('maxUsd');

    const where: Record<string, unknown> = {};
    if (!isAdmin(currentUser)) {
      where.createdBy = currentUser.id;
    }
    
    if (status) where.status = status;
    if (search) {
      assertSearchLength(search);
      where.OR = [
        { receiptNo: { contains: search } },
        { orderNo: { contains: search } },
        { invNo: { contains: search } },
        { payer: { contains: search } }
      ];
    }
    if (orderId) where.orderId = orderId;
    if (dateFrom || dateTo) {
      where.createdAt = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {})
      };
    }
    if (minUsd || maxUsd) {
      where.usd = {
        ...(minUsd ? { gte: Number(minUsd) } : {}),
        ...(maxUsd ? { lte: Number(maxUsd) } : {})
      };
    }

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
});

// 上传并识别收据
export const POST = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const { action, data, file } = await parseActionRequest(request);
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
        const imagePath = await saveUploadedImage(file);

        return NextResponse.json({ 
          success: true, 
          data: { 
            ocrResult, 
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

    if (action === 'confirm' || action === 'direct-create') {
      // 确认创建收据
      const imagePath = data.imagePath as string;
      const imageName = data.imageName as string;

      const receiptData = parseReceiptPayload(data);
      const { receiptNo, date, tel, usd, invNo, orderNo, payer, isDeposit, customerMark, customerName, customerPhone, customerCity, customerId } = receiptData;
      if (!customerMark || !customerMark.trim()) {
        return NextResponse.json({ success: false, error: '客户MARK不能为空' }, { status: 400 });
      }

      if (receiptData.receiptNo) {
        const existingReceipt = await db.receipt.findFirst({
          where: { 
            receiptNo: receiptData.receiptNo
          }
        });
        if (existingReceipt) {
          return NextResponse.json({ 
            success: false, 
            error: '收据创建失败，请稍后重试'
          }, { status: 400 });
        }
      }

      // 查找匹配的ORDER
      const normalizedOrderNo = typeof receiptData.orderNo === 'string' ? receiptData.orderNo : null;
      const matchedOrder = await findMatchingOrder(normalizedOrderNo);
      const customerResolution = await resolveCustomer({
        customerMark,
        customerName: customerName || null,
        customerId: customerId || null,
      });

      let orderId: string | null = matchedOrder?.orderId || null;

      // 如果是定金，需要创建一个独立的订单记录
      if (receiptData.isDeposit && normalizedOrderNo && !matchedOrder) {
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
            orderNo: normalizedOrderNo,
            amount: 0,
            orderBalance: -receiptData.usd,
            customerId: customerResolution.customerId,
            customerMark: customerResolution.customerMark,
            customerName: customerResolution.customerName,
            customerPhone: customerResolution.customerPhone,
            customerCity: customerResolution.customerCity,
            needsCustomerFix: customerResolution.needsCustomerFix,
          }
        });

        orderId = depositOrder.id;
      }

      // 创建收据
      const receipt = await db.receipt.create({
        data: {
          receiptNo: receiptData.receiptNo?.trim() || null,
          date: receiptData.date ? new Date(receiptData.date) : null,
          tel: receiptData.tel || null,
          usd: receiptData.usd,
          invNo: receiptData.invNo || null,
          orderNo: normalizedOrderNo,
          payer: receiptData.payer || null,
          customerId: customerResolution.customerId,
          customerMark: customerResolution.customerMark,
          customerName: customerResolution.customerName,
          customerPhone: customerResolution.customerPhone,
          customerCity: customerResolution.customerCity,
          needsCustomerFix: customerResolution.needsCustomerFix,
          isDeposit: receiptData.isDeposit || false,
          status: ReceiptStatus.SR_Received,
          imageUrl: imagePath || null,
          imageName: imageName || null,
          orderId: orderId,
          createdBy: currentUser.id
        },
        include: {
          creator: { select: { id: true, name: true, email: true } }
        }
      });

      // 更新订单余额
      if (orderId) {
        await db.order.update({
          where: { id: orderId },
          data: {
            customerId: customerResolution.customerId,
            customerMark: customerResolution.customerMark,
            customerName: customerResolution.customerName,
            customerPhone: customerResolution.customerPhone,
            customerCity: customerResolution.customerCity,
            needsCustomerFix: customerResolution.needsCustomerFix,
          },
        });
        await updateOrderBalance(orderId);
      }
      await recordAuditEvent({
        action: 'RECEIPT_CREATE',
        actorId: currentUser.id,
        targetType: 'RECEIPT',
        targetId: receipt.id,
      });

      return NextResponse.json({
        success: true,
        data: receipt,
        message: customerResolution.needsCustomerFix
          ? 'please modify guest information'
          : (action === 'direct-create' ? '收据已直接创建' : undefined),
      });
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
      if (!canAccessOwnedResource(existingReceipt.createdBy, currentUser)) {
        return forbiddenOwnershipResponse('无权修改该收据');
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
        const updateData = parseJsonWithSchema(updateDataStr, receiptPayloadSchema, '收据数据格式错误');
        const { receiptNo, date, tel, usd, invNo, orderNo, payer, isDeposit, customerMark, customerName, customerPhone, customerCity, customerId } = updateData;
        const normalizedOrderNo = orderNo;

        // 查找匹配的ORDER
        const matchedOrder = await findMatchingOrder(normalizedOrderNo);
        const customerResolution = customerMark
          ? await resolveCustomer({
              customerMark,
              customerName: customerName || null,
              customerId: customerId || null,
            })
          : null;

        // 更新收据
        const updated = await db.receipt.update({
          where: { id: receiptId },
          data: {
            receiptNo: receiptNo || null,
            date: date ? new Date(date) : null,
            tel: tel || null,
            usd,
            invNo: invNo || null,
            orderNo: normalizedOrderNo,
            payer: payer || null,
            isDeposit: isDeposit || false,
            customerId: customerResolution?.customerId ?? existingReceipt.customerId,
            customerMark: customerResolution?.customerMark ?? existingReceipt.customerMark,
            customerName: customerResolution?.customerName ?? existingReceipt.customerName,
            customerPhone: customerResolution?.customerPhone ?? existingReceipt.customerPhone,
            customerCity: customerResolution?.customerCity ?? existingReceipt.customerCity,
            needsCustomerFix: customerResolution?.needsCustomerFix ?? existingReceipt.needsCustomerFix,
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
        await recordAuditEvent({
          action: 'RECEIPT_UPDATE',
          actorId: currentUser.id,
          targetType: 'RECEIPT',
          targetId: receiptId,
        });

        return NextResponse.json({ success: true, data: updated });
      }

      return NextResponse.json({ success: false, error: '缺少更新数据' }, { status: 400 });
    }

    if (action === 'mark-received') {
      // 标记为已签收（管理员）
      if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES) {
        return NextResponse.json({ success: false, error: '只有管理员和销售代表可以标记签收' }, { status: 403 });
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
            await db.swift.updateMany({
              where: { detailId: item.detail.id },
              data: { status: 'RECEIVED' },
            });
          }
        }
      }
      await recordAuditEvent({
        action: 'RECEIPT_MARK_RECEIVED',
        actorId: currentUser.id,
        targetType: 'RECEIPT',
        targetId: receiptId,
      });

      return NextResponse.json({ success: true, data: updated });
    }

    return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
  } catch (error) {
    console.error('Receipt API error:', error);
    if (error instanceof InputValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
});
