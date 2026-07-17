import { UserRole } from '@prisma/client';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { createApiError } from '@/lib/api-error';
import { db } from '@/lib/db';
import type { CurrentUser } from '@/lib/request-auth';
import { runInTransaction } from '@/lib/transaction';
import { getHierarchyScope } from '@/lib/user-hierarchy';

const roleRank: Record<UserRole, number> = {
  [UserRole.ADMIN]: 4,
  [UserRole.SALES]: 3,
  [UserRole.USER]: 2,
};

export const roleLevel: Record<UserRole, number> = {
  [UserRole.ADMIN]: 2,
  [UserRole.SALES]: 3,
  [UserRole.USER]: 4,
};

export function parseManagedRole(value: unknown): UserRole {
  if (value === UserRole.ADMIN || value === UserRole.SALES || value === UserRole.USER) {
    return value;
  }
  return UserRole.USER;
}

export function canCreateRole(currentLevel: number, currentRole: UserRole, targetRole: UserRole): boolean {
  const targetLevel = roleLevel[targetRole];
  if (currentLevel >= 4 || currentRole === UserRole.USER) return false;
  if (targetLevel <= currentLevel) return false;
  if (currentLevel === 2 && targetRole === UserRole.ADMIN) return false;
  if (currentRole === UserRole.SALES && targetRole !== UserRole.USER) return false;
  return true;
}

function isProtectedPrimaryAdmin(target: { role: UserRole; email: string; name: string | null; createdById: string | null }): boolean {
  if (target.role !== UserRole.ADMIN) return false;
  const email = (target.email || '').trim().toLowerCase();
  const name = (target.name || '').trim().toLowerCase();
  return email === 'admin@example.com' || (name === 'admin' && !target.createdById);
}

function ensureManager(currentUser: CurrentUser): void {
  if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES) {
    throw createApiError({
      code: 'FORBIDDEN',
      status: 403,
      message: '无权限',
      detail: { role: currentUser.role },
    });
  }
}

export async function createManagedUser(
  currentUser: CurrentUser,
  input: {
    email: string;
    password: string;
    name?: string | null;
    role?: unknown;
    parentId?: string | null;
  },
) {
  ensureManager(currentUser);

  const email = String(input.email || '').trim();
  const password = String(input.password || '');
  if (!email || !password) {
    throw createApiError({ code: 'VALIDATION_ERROR', status: 400, message: '邮箱和密码不能为空' });
  }

  const targetRole = parseManagedRole(input.role);
  if (!canCreateRole(currentUser.level, currentUser.role, targetRole)) {
    throw createApiError({ code: 'ROLE_NOT_ALLOWED', status: 403, message: '当前账户无权创建该角色' });
  }

  const requestedParentId = typeof input.parentId === 'string' && input.parentId.trim() ? input.parentId.trim() : currentUser.id;
  const scope = await getHierarchyScope(currentUser);
  const parent = await db.user.findUnique({
    where: { id: requestedParentId },
    select: { id: true, level: true, role: true },
  });
  if (!parent) {
    throw createApiError({ code: 'PARENT_NOT_FOUND', status: 400, message: '指定上级不存在' });
  }

  const isVisibleParent = scope.visibleIds.has(parent.id) || parent.id === currentUser.id;
  if (!isVisibleParent) {
    throw createApiError({ code: 'PARENT_SCOPE_FORBIDDEN', status: 403, message: '无权指定该上级账户' });
  }

  if (targetRole === UserRole.SALES) {
    if (parent.role !== UserRole.ADMIN || (parent.level !== 1 && parent.level !== 2)) {
      throw createApiError({ code: 'ROLE_NOT_ALLOWED', status: 400, message: 'SALES 上级必须为 1/2 级 ADMIN' });
    }
  } else if (targetRole === UserRole.USER) {
    const parentAllowed =
      (parent.role === UserRole.SALES && parent.level === 3) ||
      (parent.role === UserRole.ADMIN && (parent.level === 1 || parent.level === 2));
    if (!parentAllowed) {
      throw createApiError({ code: 'ROLE_NOT_ALLOWED', status: 400, message: 'USER 上级必须为 1/2 级 ADMIN 或 3 级 SALES' });
    }
  } else if (targetRole === UserRole.ADMIN) {
    if (parent.level !== 1 || parent.role !== UserRole.ADMIN) {
      throw createApiError({ code: 'ROLE_NOT_ALLOWED', status: 400, message: '2级 ADMIN 只能由 1级 ADMIN 创建' });
    }
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    throw createApiError({ code: 'EMAIL_ALREADY_EXISTS', status: 400, message: '邮箱已存在' });
  }

  const hashedPassword = await hashPassword(password);
  const newUser = await runInTransaction((tx) => tx.user.create({
    data: {
      email,
      password: hashedPassword,
      name: input.name || null,
      role: targetRole,
      level: roleLevel[targetRole],
      parentId: parent.id,
      createdById: currentUser.id,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      level: true,
      parentId: true,
      createdAt: true,
      createdById: true,
    },
  }));

  await recordAuditEvent({
    action: auditActions.USER_CREATE,
    actorId: currentUser.id,
    targetType: auditTargetTypes.USER,
    targetId: newUser.id,
    metadata: {
      email: newUser.email,
      role: newUser.role,
      level: newUser.level,
      parentId: newUser.parentId,
    },
  });

  return { data: newUser, message: '用户已创建' };
}

export async function updateManagedUserRole(
  currentUser: CurrentUser,
  input: { userId: string; role?: unknown },
) {
  if (currentUser.role !== UserRole.ADMIN) {
    throw createApiError({ code: 'FORBIDDEN', status: 403, message: '无权限' });
  }

  const userId = String(input.userId || '').trim();
  if (!userId) {
    throw createApiError({ code: 'VALIDATION_ERROR', status: 400, message: '用户ID不能为空' });
  }

  const newRole = parseManagedRole(input.role);
  if (roleRank[newRole] > roleRank[currentUser.role]) {
    throw createApiError({ code: 'ROLE_NOT_ALLOWED', status: 400, message: '不能设置高于自己的角色' });
  }

  const target = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, level: true, createdById: true },
  });
  if (!target) {
    throw createApiError({ code: 'RESOURCE_NOT_FOUND', status: 404, message: '用户不存在' });
  }

  const scope = await getHierarchyScope(currentUser);
  if (!scope.descendantIds.has(target.id)) {
    throw createApiError({ code: 'ROLE_NOT_ALLOWED', status: 403, message: '只能管理下级用户' });
  }
  if (target.level === currentUser.level) {
    throw createApiError({ code: 'ROLE_NOT_ALLOWED', status: 403, message: '同级用户不可管理' });
  }
  if (isProtectedPrimaryAdmin(target)) {
    throw createApiError({ code: 'PRIMARY_ADMIN_PROTECTED', status: 400, message: '唯一管理员Admin角色不可修改' });
  }
  if (!canCreateRole(currentUser.level, currentUser.role, newRole)) {
    throw createApiError({ code: 'ROLE_NOT_ALLOWED', status: 403, message: '当前账户无权设置该角色' });
  }

  const updated = await runInTransaction((tx) => tx.user.update({
    where: { id: userId },
    data: { role: newRole, level: roleLevel[newRole] },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      level: true,
      parentId: true,
      createdAt: true,
      createdById: true,
    },
  }));

  await recordAuditEvent({
    action: auditActions.USER_ROLE_UPDATE,
    actorId: currentUser.id,
    targetType: auditTargetTypes.USER,
    targetId: updated.id,
    metadata: {
      previousRole: target.role,
      previousLevel: target.level,
      nextRole: updated.role,
      nextLevel: updated.level,
    },
  });

  return { data: updated, message: '角色已更新' };
}

export async function deleteManagedUser(currentUser: CurrentUser, userIdInput: string) {
  ensureManager(currentUser);

  const userId = String(userIdInput || '').trim();
  if (!userId) {
    throw createApiError({ code: 'VALIDATION_ERROR', status: 400, message: '用户ID不能为空' });
  }
  if (userId === currentUser.id) {
    throw createApiError({ code: 'SELF_ACTION_FORBIDDEN', status: 400, message: '不能删除自己' });
  }

  const target = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, level: true, createdById: true },
  });
  if (!target) {
    throw createApiError({ code: 'RESOURCE_NOT_FOUND', status: 404, message: '用户不存在' });
  }
  if (isProtectedPrimaryAdmin(target)) {
    throw createApiError({ code: 'PRIMARY_ADMIN_PROTECTED', status: 400, message: '唯一管理员Admin不可删除' });
  }

  const scope = await getHierarchyScope(currentUser);
  if (!scope.descendantIds.has(target.id) || target.level <= currentUser.level) {
    throw createApiError({ code: 'ROLE_NOT_ALLOWED', status: 403, message: '仅可删除下级用户' });
  }

  await runInTransaction(async (tx) => {
    await tx.invoice.updateMany({ where: { createdBy: userId }, data: { createdBy: currentUser.id } });
    await tx.order.updateMany({ where: { createdBy: userId }, data: { createdBy: currentUser.id } });
    await tx.receipt.updateMany({ where: { createdBy: userId }, data: { createdBy: currentUser.id } });
    await tx.receiptHistory.updateMany({ where: { createdBy: userId }, data: { createdBy: currentUser.id } });
    await tx.detail.updateMany({ where: { createdBy: userId }, data: { createdBy: currentUser.id } });
    await tx.detailHistory.updateMany({ where: { createdBy: userId }, data: { createdBy: currentUser.id } });
    await tx.swift.updateMany({ where: { createdBy: userId }, data: { createdBy: currentUser.id } });
    await tx.customer.updateMany({ where: { createdBy: userId }, data: { createdBy: currentUser.id } });
    await tx.customer.updateMany({ where: { ownerId: userId }, data: { ownerId: currentUser.id } });
    await tx.deletionRequest.updateMany({ where: { requestedBy: userId }, data: { requestedBy: currentUser.id } });
    await tx.auditLog.updateMany({ where: { actorId: userId }, data: { actorId: currentUser.id } });
    await tx.orderTracker.updateMany({ where: { createdBy: userId }, data: { createdBy: currentUser.id } });
    await tx.orderTracker.updateMany({ where: { updatedBy: userId }, data: { updatedBy: currentUser.id } });
    await tx.integrationSyncState.updateMany({ where: { serviceActorId: userId }, data: { serviceActorId: currentUser.id } });
    await tx.user.delete({ where: { id: userId } });
  });

  await recordAuditEvent({
    action: auditActions.USER_DELETE,
    actorId: currentUser.id,
    targetType: auditTargetTypes.USER,
    targetId: userId,
    metadata: {
      email: target.email,
      role: target.role,
      level: target.level,
      reassignedTo: currentUser.id,
    },
  });

  return { message: '用户已删除' };
}

export async function resetManagedUserPassword(
  currentUser: CurrentUser,
  input: { userId: string; password: string },
) {
  ensureManager(currentUser);

  const userId = String(input.userId || '').trim();
  const password = String(input.password || '');
  if (!userId || !password) {
    throw createApiError({ code: 'VALIDATION_ERROR', status: 400, message: '用户ID和新密码不能为空' });
  }

  const target = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, level: true },
  });
  if (!target) {
    throw createApiError({ code: 'RESOURCE_NOT_FOUND', status: 404, message: '用户不存在' });
  }

  const scope = await getHierarchyScope(currentUser);
  if (!scope.descendantIds.has(target.id) || target.level <= currentUser.level) {
    throw createApiError({ code: 'ROLE_NOT_ALLOWED', status: 403, message: '仅可重置下级用户密码' });
  }

  const hashedPassword = await hashPassword(password);
  await runInTransaction((tx) => tx.user.update({ where: { id: userId }, data: { password: hashedPassword } }));

  await recordAuditEvent({
    action: auditActions.USER_PASSWORD_RESET,
    actorId: currentUser.id,
    targetType: auditTargetTypes.USER,
    targetId: userId,
    metadata: { email: target.email, level: target.level },
  });

  return { message: '密码已重置' };
}

export async function changeCurrentUserPassword(
  currentUser: CurrentUser,
  input: { oldPassword: string; newPassword: string },
) {
  const oldPassword = String(input.oldPassword || '');
  const newPassword = String(input.newPassword || '');
  if (!oldPassword || !newPassword) {
    throw createApiError({ code: 'VALIDATION_ERROR', status: 400, message: '旧密码和新密码不能为空' });
  }
  if (newPassword.length < 8) {
    throw createApiError({ code: 'PASSWORD_TOO_SHORT', status: 400, message: '新密码至少8位' });
  }

  const userWithPassword = await db.user.findUnique({
    where: { id: currentUser.id },
    select: { id: true, password: true },
  });
  if (!userWithPassword) {
    throw createApiError({ code: 'RESOURCE_NOT_FOUND', status: 404, message: '用户不存在' });
  }

  const oldValid = await verifyPassword(oldPassword, userWithPassword.password);
  if (!oldValid) {
    throw createApiError({ code: 'INVALID_CREDENTIALS', status: 400, message: '旧密码错误' });
  }

  const hashedPassword = await hashPassword(newPassword);
  await runInTransaction((tx) => tx.user.update({ where: { id: currentUser.id }, data: { password: hashedPassword } }));

  await recordAuditEvent({
    action: auditActions.USER_PASSWORD_CHANGE,
    actorId: currentUser.id,
    targetType: auditTargetTypes.USER,
    targetId: currentUser.id,
    metadata: { changedBySelf: true },
  });

  return { message: '密码修改成功' };
}
