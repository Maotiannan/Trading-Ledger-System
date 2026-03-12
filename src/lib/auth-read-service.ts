import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { createApiError } from '@/lib/api-error';
import type { CurrentUser } from '@/lib/request-auth';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { canCreateRole, parseManagedRole } from '@/lib/auth-service';

function ensureManager(currentUser: CurrentUser): void {
  if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES) {
    throw createApiError({ code: 'FORBIDDEN', status: 403, message: '无权限' });
  }
}

export async function getCurrentAccount(currentUser: CurrentUser) {
  await recordAuditEvent({
    action: auditActions.USER_SELF_VIEW,
    actorId: currentUser.id,
    targetType: auditTargetTypes.USER,
    targetId: currentUser.id,
    metadata: {
      email: currentUser.email,
      role: currentUser.role,
      level: currentUser.level,
    },
  });

  return { data: currentUser, message: '当前用户信息已加载' };
}

export async function listManagedUserParentOptions(currentUser: CurrentUser, roleInput: unknown) {
  ensureManager(currentUser);

  const targetRole = parseManagedRole(roleInput);
  if (!canCreateRole(currentUser.level, currentUser.role, targetRole)) {
    throw createApiError({ code: 'ROLE_NOT_ALLOWED', status: 403, message: '当前账户无权创建该角色' });
  }

  const scope = await getHierarchyScope(currentUser);
  const visibleIds = Array.from(scope.visibleIds);
  const candidates = await db.user.findMany({
    where: { id: { in: visibleIds } },
    select: { id: true, email: true, name: true, role: true, level: true },
    orderBy: [{ level: 'asc' }, { createdAt: 'asc' }],
  });

  const filtered = candidates.filter((candidate) => {
    if (targetRole === UserRole.ADMIN) {
      return candidate.role === UserRole.ADMIN && candidate.level === 1;
    }
    if (targetRole === UserRole.SALES) {
      return candidate.role === UserRole.ADMIN && (candidate.level === 1 || candidate.level === 2);
    }
    return (
      (candidate.role === UserRole.ADMIN && (candidate.level === 1 || candidate.level === 2))
      || (candidate.role === UserRole.SALES && candidate.level === 3)
    );
  });

  await recordAuditEvent({
    action: auditActions.USER_PARENT_OPTIONS_VIEW,
    actorId: currentUser.id,
    targetType: auditTargetTypes.USER,
    metadata: {
      targetRole,
      candidateCount: filtered.length,
    },
  });

  return { data: filtered, message: `可选上级账户已加载，共 ${filtered.length} 个候选账号` };
}

export async function listManagedUsers(currentUser: CurrentUser) {
  ensureManager(currentUser);

  const scope = await getHierarchyScope(currentUser);
  const users = await db.user.findMany({
    where: {
      OR: [
        { id: { in: Array.from(scope.visibleIds) } },
        { level: currentUser.level },
      ],
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
    orderBy: { createdAt: 'desc' },
  });

  await recordAuditEvent({
    action: auditActions.USER_LIST_VIEW,
    actorId: currentUser.id,
    targetType: auditTargetTypes.USER,
    metadata: {
      count: users.length,
      currentRole: currentUser.role,
      currentLevel: currentUser.level,
    },
  });

  return { data: users, message: `用户列表已加载，共 ${users.length} 个账号` };
}
