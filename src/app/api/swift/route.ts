import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ReceiptStatus, DetailStatus, SwiftStatus } from '@prisma/client';
import { recognizeSwift } from '@/lib/ocr';
import { validateAmountTolerance } from '@/lib/matching';
import { withAuth } from '@/lib/route-auth';
import { saveUploadedImage, UploadValidationError } from '@/lib/upload';
import { canAccessOwnedResourceAsync, forbiddenOwnershipResponse } from '@/lib/ownership';
import { assertSearchLength, InputValidationError, parseJsonWithSchema, swiftPayloadSchema } from '@/lib/validators';
import { recordAuditEvent } from '@/lib/audit';
import { parseActionRequest } from '@/lib/http-body';
import { toOcrDataUrl } from '@/lib/ocr-input';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { filterRowsBySearch } from '@/lib/text-search';

function parseSwiftPayload(data: Record<string, unknown>) {
  if (typeof data.data === 'string') {
    return parseJsonWithSchema(data.data, swiftPayloadSchema, 'SWIFT数据格式错误');
  }
  const result = swiftPayloadSchema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new InputValidationError(issue?.message || 'SWIFT数据格式错误');
  }
  return result.data;
}

// 获取SWIFT列表
export const GET = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const minAmount = searchParams.get('minAmount');
    const maxAmount = searchParams.get('maxAmount');
    const hasError = searchParams.get('hasError');

    const scope = await getHierarchyScope(currentUser);
    const ownerIds = Array.from(scope.ownerVisibleIds);
    const filters: Record<string, unknown>[] = [
      {
        OR: [
          { createdBy: { in: ownerIds } },
          { detail: { items: { some: { receipt: { customer: { createdBy: { in: ownerIds } } } } } } },
        ],
      },
    ];
    if (search) assertSearchLength(search);
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
        amount: {
          ...(minAmount ? { gte: Number(minAmount) } : {}),
          ...(maxAmount ? { lte: Number(maxAmount) } : {})
        },
      });
    }
    if (hasError === 'true' || hasError === 'false') {
      filters.push({ hasError: hasError === 'true' });
    }
    const where = filters.length === 1 ? filters[0] : { AND: filters };

    const swifts = await db.swift.findMany({
      where,
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

    return NextResponse.json({ success: true, data: filterRowsBySearch(swifts, search) });
  } catch (error) {
    console.error('Get swifts error:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
});

// 上传并识别SWIFT
export const POST = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const { action, data: requestData, file } = await parseActionRequest(request);
    const detailId = (requestData.detailId as string) || '';

    if (action === 'recognize') {
      // AI识别SWIFT
      if (!file) {
        return NextResponse.json({ success: false, error: '请上传图片' }, { status: 400 });
      }

      try {
        const base64 = await toOcrDataUrl(file);

        // AI识别
        const ocrResult = await recognizeSwift(base64);

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
        const detail = ocrError instanceof Error ? ocrError.message : '未知错误';
        return NextResponse.json({ 
          success: false, 
          error: `AI识别失败：${detail}` 
        }, { status: 500 });
      }
    }

    if (action === 'confirm' || action === 'direct-create') {
      // 确认创建SWIFT
      const imagePath = requestData.imagePath as string;
      const imageName = requestData.imageName as string;
      
      if (!detailId) {
        return NextResponse.json({ success: false, error: '缺少必要数据' }, { status: 400 });
      }

      const data = parseSwiftPayload(requestData);
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
      if (!(await canAccessOwnedResourceAsync(detail.createdBy, currentUser))) {
        return forbiddenOwnershipResponse('无权关联该付款明细');
      }

      const existingSwift = await db.swift.findUnique({
        where: { detailId },
        select: { id: true, hasError: true, createdBy: true },
      });
      if (existingSwift && !existingSwift.hasError) {
        return NextResponse.json({ success: false, error: '该付款明细已创建SWIFT，请勿重复提交' }, { status: 400 });
      }
      if (existingSwift && existingSwift.hasError) {
        if (!(await canAccessOwnedResourceAsync(existingSwift.createdBy, currentUser))) {
          return forbiddenOwnershipResponse('无权覆盖该错误SWIFT记录');
        }
        await db.swift.delete({ where: { id: existingSwift.id } });
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
          imageUrl: imagePath || null,
          imageName: imageName || null,
          status: validation.valid ? SwiftStatus.Bank_Transfer : SwiftStatus.ERROR,
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
        await db.swift.update({
          where: { id: swift.id },
          data: { status: SwiftStatus.Bank_Transfer },
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
        // 金额不匹配时仅标记 SWIFT 为 ERROR，不改动 DETAIL/RECEIPT 状态
        await db.swift.update({
          where: { id: swift.id },
          data: { status: SwiftStatus.ERROR },
        });
        console.log(`Swift ${swift.id} marked as ERROR due to amount mismatch`);
      }
      await recordAuditEvent({
        action: 'SWIFT_CREATE',
        actorId: currentUser.id,
        targetType: 'SWIFT',
        targetId: swift.id,
      });

      return NextResponse.json({
        success: true, 
        data: { swift, validation },
        message: action === 'direct-create' ? 'SWIFT已直接创建' : undefined,
      });
    }

    if (action === 'delete') {
      // 删除SWIFT：
      // 1) 管理员可删除所有记录
      // 2) 错误记录（hasError=true）允许记录创建者直接删除

      const swiftId = (requestData.swiftId as string) || '';
      
      if (!swiftId) {
        return NextResponse.json({ success: false, error: '缺少SWIFT ID' }, { status: 400 });
      }

      const existingSwift = await db.swift.findUnique({
        where: { id: swiftId }
      });

      if (!existingSwift) {
        return NextResponse.json({ success: false, error: 'SWIFT不存在' }, { status: 400 });
      }
      const canDeleteErrorSwiftDirectly =
        existingSwift.hasError && (await canAccessOwnedResourceAsync(existingSwift.createdBy, currentUser));
      if (currentUser.role !== 'ADMIN' && !canDeleteErrorSwiftDirectly) {
        return NextResponse.json({ success: false, error: '只有管理员可以删除该SWIFT记录' }, { status: 403 });
      }

      // 删除SWIFT
      await db.swift.delete({ where: { id: swiftId } });

      if (existingSwift.hasError) {
        await recordAuditEvent({
          action: 'SWIFT_DELETE',
          actorId: currentUser.id,
          targetType: 'SWIFT',
          targetId: swiftId,
        });
        return NextResponse.json({ success: true, message: '错误SWIFT记录已删除' });
      }

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
      await recordAuditEvent({
        action: 'SWIFT_DELETE',
        actorId: currentUser.id,
        targetType: 'SWIFT',
        targetId: swiftId,
      });

      return NextResponse.json({ success: true, message: 'SWIFT已删除，状态已回退' });
    }

    return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
  } catch (error) {
    console.error('Swift API error:', error);
    const prismaError = error as { code?: string };
    if (prismaError?.code === 'P2002') {
      return NextResponse.json({ success: false, error: '该付款明细已创建SWIFT，请刷新后查看' }, { status: 400 });
    }
    if (error instanceof InputValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
});
