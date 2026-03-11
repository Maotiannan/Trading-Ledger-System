import {
  DetailStatus,
  ReceiptStatus,
  SwiftStatus,
  UserRole,
} from '@prisma/client';
import { db } from '@/lib/db';
import { canAccessOwnedResourceAsync } from '@/lib/ownership';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { createApiError } from '@/lib/api-error';
import { runInTransaction } from '@/lib/transaction';
import { getNumericSystemSetting } from '@/lib/system-settings';
import { validateAmountTolerance } from '@/lib/matching';
import type { CurrentUser } from '@/lib/request-auth';
import type { SwiftPayload } from '@/lib/validators';

function createForbiddenError(message: string, detail?: unknown) {
  return createApiError({
    code: 'FORBIDDEN',
    status: 403,
    message,
    detail,
  });
}

export async function createSwiftRecord(params: {
  currentUser: CurrentUser;
  detailId: string;
  payload: SwiftPayload;
  imagePath?: string | null;
  imageName?: string | null;
  mode: 'confirm' | 'direct-create';
}): Promise<{
  swift: Awaited<ReturnType<typeof db.swift.create>>;
  validation: ReturnType<typeof validateAmountTolerance>;
  message?: string;
}> {
  const { currentUser, detailId, payload, imagePath, imageName, mode } = params;
  if (!detailId) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: '缺少必要数据',
    });
  }

  const detail = await db.detail.findUnique({
    where: { id: detailId },
    include: {
      items: { include: { receipt: true } },
    },
  });
  if (!detail) {
    throw createApiError({
      code: 'RESOURCE_NOT_FOUND',
      status: 400,
      message: '关联的付款明细不存在',
      detail: { detailId },
    });
  }
  if (!(await canAccessOwnedResourceAsync(detail.createdBy, currentUser))) {
    throw createForbiddenError('无权关联该付款明细', {
      detailId,
      detailCreatedBy: detail.createdBy,
    });
  }

  const existingSwift = await db.swift.findUnique({
    where: { detailId },
    select: { id: true, hasError: true, createdBy: true },
  });
  if (existingSwift && !existingSwift.hasError) {
    throw createApiError({
      code: 'CONFLICT',
      status: 400,
      message: '该付款明细已创建SWIFT，请勿重复提交',
      detail: { detailId, swiftId: existingSwift.id },
    });
  }
  if (existingSwift && existingSwift.hasError) {
    const canOverride = await canAccessOwnedResourceAsync(existingSwift.createdBy, currentUser);
    if (!canOverride) {
      throw createForbiddenError('无权覆盖该错误SWIFT记录', {
        detailId,
        swiftId: existingSwift.id,
        swiftCreatedBy: existingSwift.createdBy,
      });
    }
  }

  const [warningTolerance, rejectTolerance] = await Promise.all([
    getNumericSystemSetting('SWIFT_WARNING_TOLERANCE', 5, { min: 0 }),
    getNumericSystemSetting('SWIFT_REJECT_TOLERANCE', 50, { min: 0 }),
  ]);

  const validation = validateAmountTolerance(Number(detail.totalAmount), payload.amount, {
    warningTolerance,
    rejectTolerance,
  });

  try {
    const swift = await runInTransaction(async (tx) => {
      if (existingSwift?.hasError) {
        await tx.swift.delete({ where: { id: existingSwift.id } });
      }

      const created = await tx.swift.create({
        data: {
          detailId,
          amount: payload.amount,
          date: payload.date ? new Date(payload.date) : null,
          senderName: payload.senderName,
          senderAddress: payload.senderAddress,
          receiverName: payload.receiverName,
          receiverAccount: payload.receiverAccount,
          imageUrl: imagePath || null,
          imageName: imageName || null,
          status: validation.valid ? SwiftStatus.Bank_Transfer : SwiftStatus.ERROR,
          hasError: validation.hasWarning || !validation.valid,
          errorMessage: validation.valid ? null : validation.message,
          createdBy: currentUser.id,
        },
        include: {
          detail: true,
        },
      });

      if (validation.valid) {
        await tx.detail.update({
          where: { id: detailId },
          data: { status: DetailStatus.Bank_Transfer },
        });

        const receiptIds = detail.items
          .map((item) => item.receiptId)
          .filter((receiptId): receiptId is string => Boolean(receiptId));
        if (receiptIds.length > 0) {
          await tx.receipt.updateMany({
            where: { id: { in: receiptIds } },
            data: { status: ReceiptStatus.Bank_Transfer },
          });
        }
      }

      return created;
    });

    await recordAuditEvent({
      action: auditActions.SWIFT_CREATE,
      actorId: currentUser.id,
      targetType: auditTargetTypes.SWIFT,
      targetId: swift.id,
      metadata: {
        mode,
        warningTolerance,
        rejectTolerance,
        validation,
      },
    });

    return {
      swift,
      validation,
      message: mode === 'direct-create' ? 'SWIFT已直接创建' : undefined,
    };
  } catch (error) {
    const prismaError = error as { code?: string };
    if (prismaError?.code === 'P2002') {
      throw createApiError({
        code: 'CONFLICT',
        status: 400,
        message: '该付款明细已创建SWIFT，请刷新后查看',
        detail: { detailId },
      });
    }
    throw error;
  }
}

export async function deleteSwiftRecord(params: {
  currentUser: CurrentUser;
  swiftId: string;
}): Promise<{ message: string }> {
  const { currentUser, swiftId } = params;
  if (!swiftId) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: '缺少SWIFT ID',
    });
  }

  const existingSwift = await db.swift.findUnique({
    where: { id: swiftId },
  });
  if (!existingSwift) {
    throw createApiError({
      code: 'RESOURCE_NOT_FOUND',
      status: 400,
      message: 'SWIFT不存在',
      detail: { swiftId },
    });
  }

  const canDeleteErrorSwiftDirectly =
    existingSwift.hasError && (await canAccessOwnedResourceAsync(existingSwift.createdBy, currentUser));
  if (currentUser.role !== UserRole.ADMIN && !canDeleteErrorSwiftDirectly) {
    throw createForbiddenError('只有管理员可以删除该SWIFT记录', {
      swiftId,
      role: currentUser.role,
      hasError: existingSwift.hasError,
    });
  }

  await runInTransaction(async (tx) => {
    await tx.swift.delete({ where: { id: swiftId } });

    if (existingSwift.hasError) {
      return;
    }

    await tx.detail.update({
      where: { id: existingSwift.detailId },
      data: { status: DetailStatus.Waiting_SWIFT },
    });

    const detail = await tx.detail.findUnique({
      where: { id: existingSwift.detailId },
      include: { items: true },
    });
    const receiptIds = detail?.items
      .map((item) => item.receiptId)
      .filter((receiptId): receiptId is string => Boolean(receiptId)) ?? [];
    if (receiptIds.length > 0) {
      await tx.receipt.updateMany({
        where: { id: { in: receiptIds } },
        data: { status: ReceiptStatus.Waiting_SWIFT },
      });
    }
  });

  await recordAuditEvent({
    action: auditActions.SWIFT_DELETE,
    actorId: currentUser.id,
    targetType: auditTargetTypes.SWIFT,
    targetId: swiftId,
    metadata: {
      hadError: existingSwift.hasError,
    },
  });

  return {
    message: existingSwift.hasError ? '错误SWIFT记录已删除' : 'SWIFT已删除，状态已回退',
  };
}
