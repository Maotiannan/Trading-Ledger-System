import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ReceiptStatus, DetailStatus } from '@prisma/client';
import { recognizeSwift } from '@/lib/ocr';
import { validateAmountTolerance } from '@/lib/matching';
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

// 获取SWIFT列表
export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const swifts = await db.swift.findMany({
      include: {
        detail: {
          include: {
            items: { include: { receipt: true } }
          }
        },
        creator: { select: { id: true, name: true, email: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json({ success: true, data: swifts });
  } catch (error) {
    console.error('Get swifts error:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}

// 上传并识别SWIFT
export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const action = formData.get('action') as string;
    const detailId = formData.get('detailId') as string;

    if (action === 'recognize') {
      // AI识别SWIFT
      if (!file) {
        return NextResponse.json({ success: false, error: '请上传图片' }, { status: 400 });
      }

      try {
        // 转换为base64
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const base64 = `data:${file.type};base64,${buffer.toString('base64')}`;

        // AI识别
        const ocrResult = await recognizeSwift(base64);

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
      // 确认创建SWIFT
      const dataStr = formData.get('data') as string;
      const imagePath = formData.get('imagePath') as string;
      const imageName = formData.get('imageName') as string;
      
      if (!dataStr || !detailId) {
        return NextResponse.json({ success: false, error: '缺少必要数据' }, { status: 400 });
      }

      const data = JSON.parse(dataStr);
      const { amount, date, senderName, senderAddress, receiverName, receiverAccount } = data;

      // 获取关联的DETAIL
      const detail = await db.detail.findUnique({
        where: { id: detailId },
        include: {
          items: { include: { receipt: true } }
        }
      });

      if (!detail) {
        return NextResponse.json({ success: false, error: '关联的付款明细不存在' }, { status: 400 });
      }

      // 验证金额
      const validation = validateAmountTolerance(detail.totalAmount, amount);

      // 创建SWIFT
      const swift = await db.swift.create({
        data: {
          detailId,
          amount,
          date: date ? new Date(date) : null,
          senderName,
          senderAddress,
          receiverName,
          receiverAccount,
          imageUrl: imagePath,
          imageName,
          hasError: validation.hasWarning || !validation.valid,
          errorMessage: validation.valid ? null : validation.message,
          createdBy: currentUser.id
        },
        include: {
          detail: true
        }
      });

      // 更新DETAIL状态
      if (validation.valid) {
        // 更新DETAIL状态为Bank_Transfer
        await db.detail.update({
          where: { id: detailId },
          data: { status: DetailStatus.Bank_Transfer }
        });

        // 更新关联的所有RECEIPT状态为Bank_Transfer
        for (const item of detail.items) {
          if (item.receiptId) {
            console.log(`Updating receipt ${item.receiptId} to Bank_Transfer`);
            await db.receipt.update({
              where: { id: item.receiptId },
              data: { status: ReceiptStatus.Bank_Transfer }
            });
          }
        }
        console.log(`Detail ${detailId} and associated receipts updated to Bank_Transfer`);
      } else {
        // 金额不匹配，更新DETAIL为ERROR状态
        await db.detail.update({
          where: { id: detailId },
          data: { status: DetailStatus.ERROR }
        });
        console.log(`Detail ${detailId} marked as ERROR due to amount mismatch`);
      }

      return NextResponse.json({ 
        success: true, 
        data: { swift, validation } 
      });
    }

    if (action === 'delete') {
      // 删除SWIFT（需要审批）
      const swiftId = formData.get('swiftId') as string;
      
      if (!swiftId) {
        return NextResponse.json({ success: false, error: '缺少SWIFT ID' }, { status: 400 });
      }

      const existingSwift = await db.swift.findUnique({
        where: { id: swiftId }
      });

      if (!existingSwift) {
        return NextResponse.json({ success: false, error: 'SWIFT不存在' }, { status: 400 });
      }

      // 删除SWIFT
      await db.swift.delete({ where: { id: swiftId } });

      // DETAIL回退到Waiting_SWIFT状态
      await db.detail.update({
        where: { id: existingSwift.detailId },
        data: { status: DetailStatus.Waiting_SWIFT }
      });

      // 关联的RECEIPT也回退
      const detail = await db.detail.findUnique({
        where: { id: existingSwift.detailId },
        include: { items: true }
      });

      if (detail) {
        for (const item of detail.items) {
          if (item.receiptId) {
            await db.receipt.update({
              where: { id: item.receiptId },
              data: { status: ReceiptStatus.Waiting_SWIFT }
            });
          }
        }
      }

      return NextResponse.json({ success: true, message: 'SWIFT已删除，状态已回退' });
    }

    return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
  } catch (error) {
    console.error('Swift API error:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
