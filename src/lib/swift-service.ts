import { Prisma, SwiftStatus, UploadedAssetAttachmentType, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { canAccessOwnedResourceAsync } from '@/lib/ownership';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { createApiError } from '@/lib/api-error';
import { runInTransaction, type DbTransactionClient } from '@/lib/transaction';
import type { CurrentUser } from '@/lib/request-auth';
import type { SwiftPayload } from '@/lib/validators';
import { attachUploadedAssetByPath } from '@/lib/uploaded-asset-service';
import { calculateSwiftTransferSummary } from '@/lib/swift-transfer-summary';
import { getSwiftFeePerCopy, lockSwiftDetail, syncSwiftTransferState } from '@/lib/swift-transfer-service';
import { addMoney, toDecimal } from '@/lib/money';

function badRequest(message: string) {
  return createApiError({ code: 'BAD_REQUEST', status: 400, message });
}

async function assertAccess(createdBy: string, currentUser: CurrentUser, message: string) {
  if (!(await canAccessOwnedResourceAsync(createdBy, currentUser))) {
    throw createApiError({ code: 'FORBIDDEN', status: 403, message });
  }
}

function assertAmount(totalAmount: Prisma.Decimal, amounts: Prisma.Decimal[], amount: number) {
  if (toDecimal(amount).lte(0) || addMoney([...amounts, amount]).gt(totalAmount)) {
    throw createApiError({
      code: 'VALIDATION_ERROR', status: 400,
      message: 'SWIFT累计金额不能超过付款明细总额',
    });
  }
  return { valid: true, hasWarning: false, message: '' };
}

async function loadSwiftForMutation(tx: DbTransactionClient, swiftId: string) {
  const swift = await tx.swift.findUnique({ where: { id: swiftId } });
  if (!swift) throw badRequest('SWIFT不存在');
  await lockSwiftDetail(tx, swift.detailId);
  const current = await tx.swift.findUnique({ where: { id: swiftId }, include: { detail: { include: { swifts: true } } } });
  if (!current) throw badRequest('SWIFT不存在');
  return current;
}

async function applySwiftUpdate(params: {
  tx: DbTransactionClient;
  currentUser: CurrentUser;
  swiftId: string;
  payload: SwiftPayload;
  maxFeePerCopy: number;
}) {
  const { tx, currentUser, swiftId, payload, maxFeePerCopy } = params;
  const existing = await loadSwiftForMutation(tx, swiftId);
  await assertAccess(existing.createdBy, currentUser, '无权修改该SWIFT记录');
  if (existing.status === SwiftStatus.RECEIVED) throw badRequest('RECEIVED状态下禁止修改SWIFT');
  if (existing.detail.status === 'RECEIVED') throw badRequest('RECEIVED状态下禁止修改SWIFT');
  const others = existing.detail.swifts.filter((swift) => swift.id !== swiftId && !swift.hasError && swift.status !== 'ERROR');
  const validation = assertAmount(existing.detail.totalAmount, others.map((swift) => swift.amount), payload.amount);
  const swift = await tx.swift.update({
    where: { id: swiftId },
    data: {
      ...payload, date: payload.date ? new Date(payload.date) : null,
      status: SwiftStatus.Bank_Transfer, hasError: false, errorMessage: null,
    },
  });
  const summary = await syncSwiftTransferState(tx, existing.detailId, maxFeePerCopy);
  return { swift, validation, summary };
}

export async function createSwiftRecord(params: {
  currentUser: CurrentUser;
  detailId: string;
  payload: SwiftPayload;
  imagePath?: string | null;
  imageName?: string | null;
  mode: 'confirm' | 'direct-create';
}) {
  const { currentUser, detailId, payload, imagePath, imageName, mode } = params;
  if (!detailId) throw badRequest('缺少必要数据');
  const maxFeePerCopy = await getSwiftFeePerCopy();
  const result = await runInTransaction(async (tx) => {
    await lockSwiftDetail(tx, detailId);
    const detail = await tx.detail.findUnique({ where: { id: detailId }, include: { swifts: true } });
    if (!detail) throw badRequest('关联的付款明细不存在');
    await assertAccess(detail.createdBy, currentUser, '无权关联该付款明细');
    const before = calculateSwiftTransferSummary(detail.totalAmount, detail.swifts, maxFeePerCopy);
    if (detail.status === 'RECEIVED' || before.remainingAmount <= 0) {
      throw badRequest('该付款明细的SWIFT已足额或已完成签收');
    }
    const valid = detail.swifts.filter((swift) => !swift.hasError && swift.status !== 'ERROR');
    const validation = assertAmount(detail.totalAmount, valid.map((swift) => swift.amount), payload.amount);
    const swift = await tx.swift.create({
      data: {
        detailId, ...payload, date: payload.date ? new Date(payload.date) : null,
        imageUrl: imagePath || null, imageName: imageName || null,
        status: SwiftStatus.Bank_Transfer, hasError: false, errorMessage: null, createdBy: currentUser.id,
      },
      include: { detail: true },
    });
    if (swift.imageUrl) {
      await attachUploadedAssetByPath({ client: tx, path: swift.imageUrl, attachedType: UploadedAssetAttachmentType.SWIFT, attachedId: swift.id });
    }
    const summary = await syncSwiftTransferState(tx, detailId, maxFeePerCopy);
    return { swift, validation, summary };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  await recordAuditEvent({
    action: auditActions.SWIFT_CREATE, actorId: currentUser.id, targetType: auditTargetTypes.SWIFT, targetId: result.swift.id,
    metadata: { mode, detailId, maxFeePerCopy, summary: result.summary },
  });
  return { ...result, message: mode === 'direct-create' ? 'SWIFT已直接创建' : undefined };
}

export async function updateSwiftRecord(params: {
  currentUser: CurrentUser;
  swiftId: string;
  payload: SwiftPayload;
  txClient?: DbTransactionClient | typeof db;
  skipAudit?: boolean;
}) {
  const { currentUser, swiftId, payload, txClient, skipAudit = false } = params;
  if (!swiftId) throw badRequest('缺少SWIFT ID');
  const maxFeePerCopy = await getSwiftFeePerCopy();
  const updated = txClient
    ? await applySwiftUpdate({ tx: txClient, currentUser, swiftId, payload, maxFeePerCopy })
    : await runInTransaction((tx) => applySwiftUpdate({ tx, currentUser, swiftId, payload, maxFeePerCopy }), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  if (!skipAudit) await recordAuditEvent({
    action: auditActions.SWIFT_UPDATE, actorId: currentUser.id, targetType: auditTargetTypes.SWIFT, targetId: swiftId,
    metadata: { validation: updated.validation, summary: updated.summary },
  });
  return { data: updated.swift, validation: updated.validation };
}

export async function markSwiftReceived(params: { currentUser: CurrentUser; swiftId: string }) {
  const { currentUser, swiftId } = params;
  if (currentUser.role !== UserRole.ADMIN) throw createApiError({ code: 'FORBIDDEN', status: 403, message: '只有管理员可以签收SWIFT' });
  if (!swiftId) throw badRequest('缺少SWIFT ID');
  const maxFeePerCopy = await getSwiftFeePerCopy();
  const result = await runInTransaction(async (tx) => {
    const existing = await loadSwiftForMutation(tx, swiftId);
    await assertAccess(existing.createdBy, currentUser, '无权签收该SWIFT记录');
    if (existing.status === SwiftStatus.RECEIVED) throw badRequest('SWIFT已签收，无需重复确认');
    if (existing.status === SwiftStatus.ERROR || existing.hasError) throw badRequest('异常SWIFT不能签收，请先修复');
    const swift = await tx.swift.update({ where: { id: swiftId }, data: { status: SwiftStatus.RECEIVED } });
    const summary = await syncSwiftTransferState(tx, existing.detailId, maxFeePerCopy);
    return { swift, summary, detailId: existing.detailId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  await recordAuditEvent({
    action: auditActions.SWIFT_MARK_RECEIVED, actorId: currentUser.id, targetType: auditTargetTypes.SWIFT, targetId: swiftId,
    metadata: { detailId: result.detailId, summary: result.summary },
  });
  return { data: result.swift };
}

export async function deleteSwiftRecord(params: { currentUser: CurrentUser; swiftId: string }): Promise<{ message: string }> {
  const { currentUser, swiftId } = params;
  if (!swiftId) throw badRequest('缺少SWIFT ID');
  const maxFeePerCopy = await getSwiftFeePerCopy();
  const result = await runInTransaction(async (tx) => {
    const existing = await loadSwiftForMutation(tx, swiftId);
    const canDeleteError = existing.hasError && await canAccessOwnedResourceAsync(existing.createdBy, currentUser);
    if (currentUser.role !== UserRole.ADMIN && !canDeleteError) throw createApiError({ code: 'FORBIDDEN', status: 403, message: '只有管理员可以删除该SWIFT记录' });
    await assertAccess(existing.createdBy, currentUser, '无权删除该SWIFT记录');
    await tx.swift.delete({ where: { id: swiftId } });
    const summary = await syncSwiftTransferState(tx, existing.detailId, maxFeePerCopy);
    return { hadError: existing.hasError, summary };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  await recordAuditEvent({
    action: auditActions.SWIFT_DELETE, actorId: currentUser.id, targetType: auditTargetTypes.SWIFT, targetId: swiftId,
    metadata: result,
  });
  return { message: result.hadError ? '错误SWIFT记录已删除' : 'SWIFT已删除，状态已重新计算' };
}
