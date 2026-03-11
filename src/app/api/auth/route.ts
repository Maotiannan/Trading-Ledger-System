import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword, validateUser, verifyPassword } from '@/lib/auth';
import { UserRole } from '@prisma/client';
import { type ApiErrorCode, apiErrorCodes, createApiError } from '@/lib/api-error';
import { createApiErrorResponse, toApiErrorResponse } from '@/lib/api-error-response';
import { getCurrentUser } from '@/lib/request-auth';
import { clearSessionCookie, createSessionToken, setSessionCookie } from '@/lib/session';
import { getHierarchyScope } from '@/lib/user-hierarchy';

const roleRank: Record<UserRole, number> = {
  [UserRole.ADMIN]: 4,
  [UserRole.SALES]: 3,
  [UserRole.USER]: 2,
};

const roleLevel: Record<UserRole, number> = {
  [UserRole.ADMIN]: 2,
  [UserRole.SALES]: 3,
  [UserRole.USER]: 4,
};

function parseRole(value: unknown): UserRole {
  if (value === UserRole.ADMIN || value === UserRole.SALES || value === UserRole.USER) {
    return value;
  }
  return UserRole.USER;
}

function isProtectedPrimaryAdmin(target: { role: UserRole; email: string; name: string | null; createdById: string | null }): boolean {
  if (target.role !== UserRole.ADMIN) return false;
  const email = (target.email || '').trim().toLowerCase();
  const name = (target.name || '').trim().toLowerCase();
  return email === 'admin@example.com' || (name === 'admin' && !target.createdById);
}

function canCreateRole(currentLevel: number, currentRole: UserRole, targetRole: UserRole): boolean {
  const targetLevel = roleLevel[targetRole];
  if (currentLevel >= 4 || currentRole === UserRole.USER) return false;
  if (targetLevel <= currentLevel) return false; // 不允许创建同级或上级
  if (currentLevel === 2 && targetRole === UserRole.ADMIN) return false; // 2级admin不能创建admin
  if (currentRole === UserRole.SALES && targetRole !== UserRole.USER) return false;
  return true;
}

function badRequest(request: NextRequest, message: string, code: ApiErrorCode = apiErrorCodes.BAD_REQUEST, detail?: unknown) {
  return createApiErrorResponse({ code, status: 400, message, detail }, request);
}

function unauthorized(request: NextRequest, message: string, code: ApiErrorCode = apiErrorCodes.AUTH_REQUIRED, detail?: unknown) {
  return createApiErrorResponse({ code, status: 401, message, detail }, request);
}

function forbidden(request: NextRequest, message: string, code: ApiErrorCode = apiErrorCodes.FORBIDDEN, detail?: unknown) {
  return createApiErrorResponse({ code, status: 403, message, detail }, request);
}

function notFound(request: NextRequest, message: string, detail?: unknown) {
  return createApiErrorResponse({ code: apiErrorCodes.RESOURCE_NOT_FOUND, status: 404, message, detail }, request);
}

// 登录
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, email, password, name, userId } = body;

    // 登录
    if (action === 'login') {
      if (!email || !password) {
        return badRequest(request, '邮箱和密码不能为空', apiErrorCodes.VALIDATION_ERROR);
      }

      const user = await validateUser(email, password);
      if (!user) {
        return unauthorized(request, '邮箱或密码错误', apiErrorCodes.INVALID_CREDENTIALS);
      }

      const response = NextResponse.json({ success: true, data: user });
      const token = createSessionToken(user.id);
      setSessionCookie(response, token);
      return response;
    }

    if (action === 'logout') {
      const response = NextResponse.json({ success: true, message: '已退出登录' });
      clearSessionCookie(response);
      return response;
    }

    // 获取当前用户
    if (action === 'me') {
      const user = await getCurrentUser(request);
      if (!user) {
        return unauthorized(request, '未登录');
      }
      return NextResponse.json({ success: true, data: user });
    }

    // 创建用户 (管理员/销售)
    if (action === 'create') {
      const currentUser = await getCurrentUser(request);
      if (!currentUser || (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES)) {
        return forbidden(request, '无权限');
      }

      if (!email || !password) {
        return badRequest(request, '邮箱和密码不能为空', apiErrorCodes.VALIDATION_ERROR);
      }

      const requestedRole = parseRole(body.role);
      const targetRole = requestedRole;
      if (!canCreateRole(currentUser.level, currentUser.role, targetRole)) {
        return forbidden(request, '当前账户无权创建该角色', apiErrorCodes.ROLE_NOT_ALLOWED);
      }

      const targetLevel = roleLevel[targetRole];
      const requestedParentId = typeof body.parentId === 'string' && body.parentId.trim() ? body.parentId.trim() : currentUser.id;
      const scope = await getHierarchyScope(currentUser);
      const parent = await db.user.findUnique({
        where: { id: requestedParentId },
        select: { id: true, level: true, role: true },
      });
      if (!parent) {
        return badRequest(request, '指定上级不存在', apiErrorCodes.PARENT_NOT_FOUND);
      }

      const isVisibleParent = scope.visibleIds.has(parent.id) || parent.id === currentUser.id;
      if (!isVisibleParent) {
        return forbidden(request, '无权指定该上级账户', apiErrorCodes.PARENT_SCOPE_FORBIDDEN);
      }

      if (targetRole === UserRole.SALES) {
        if (parent.role !== UserRole.ADMIN || (parent.level !== 1 && parent.level !== 2)) {
          return badRequest(request, 'SALES 上级必须为 1/2 级 ADMIN', apiErrorCodes.ROLE_NOT_ALLOWED);
        }
      } else if (targetRole === UserRole.USER) {
        const parentAllowed = (parent.role === UserRole.SALES && parent.level === 3) ||
          (parent.role === UserRole.ADMIN && (parent.level === 1 || parent.level === 2));
        if (!parentAllowed) {
          return badRequest(request, 'USER 上级必须为 1/2 级 ADMIN 或 3 级 SALES', apiErrorCodes.ROLE_NOT_ALLOWED);
        }
      } else if (targetRole === UserRole.ADMIN) {
        if (parent.level !== 1 || parent.role !== UserRole.ADMIN) {
          return badRequest(request, '2级 ADMIN 只能由 1级 ADMIN 创建', apiErrorCodes.ROLE_NOT_ALLOWED);
        }
      }

      const existing = await db.user.findUnique({ where: { email } });
      if (existing) {
        return badRequest(request, '邮箱已存在', apiErrorCodes.EMAIL_ALREADY_EXISTS);
      }

      const hashedPassword = await hashPassword(password);
      const newUser = await db.user.create({
        data: {
          email,
          password: hashedPassword,
          name: name || null,
          role: targetRole,
          level: targetLevel,
          parentId: parent.id,
          createdById: currentUser.id,
        },
        select: { id: true, email: true, name: true, role: true, level: true, parentId: true, createdAt: true, createdById: true }
      });

      return NextResponse.json({ success: true, data: newUser });
    }

    // 更新用户角色（仅管理员）
    if (action === 'update-role') {
      const currentUser = await getCurrentUser(request);
      if (!currentUser || currentUser.role !== UserRole.ADMIN) {
        return forbidden(request, '无权限');
      }

      if (!userId) {
        return badRequest(request, '用户ID不能为空', apiErrorCodes.VALIDATION_ERROR);
      }
      const newRole = parseRole(body.role);
      if (roleRank[newRole] > roleRank[currentUser.role]) {
        return badRequest(request, '不能设置高于自己的角色', apiErrorCodes.ROLE_NOT_ALLOWED);
      }

      const target = await db.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, role: true, level: true, createdById: true },
      });
      if (!target) {
        return notFound(request, '用户不存在');
      }
      const scope = await getHierarchyScope(currentUser);
      if (!scope.descendantIds.has(target.id)) {
        return forbidden(request, '只能管理下级用户', apiErrorCodes.ROLE_NOT_ALLOWED);
      }
      if (target.level === currentUser.level) {
        return forbidden(request, '同级用户不可管理', apiErrorCodes.ROLE_NOT_ALLOWED);
      }
      if (isProtectedPrimaryAdmin(target)) {
        return badRequest(request, '唯一管理员Admin角色不可修改', apiErrorCodes.PRIMARY_ADMIN_PROTECTED);
      }
      if (!canCreateRole(currentUser.level, currentUser.role, newRole)) {
        return forbidden(request, '当前账户无权设置该角色', apiErrorCodes.ROLE_NOT_ALLOWED);
      }

      const updated = await db.user.update({
        where: { id: userId },
        data: { role: newRole, level: roleLevel[newRole] },
        select: { id: true, email: true, name: true, role: true, level: true, parentId: true, createdAt: true, createdById: true },
      });
      return NextResponse.json({ success: true, data: updated, message: '角色已更新' });
    }

    // 创建用户时可选的上级列表
    if (action === 'parent-options') {
      const currentUser = await getCurrentUser(request);
      if (!currentUser || (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES)) {
        return forbidden(request, '无权限');
      }

      const targetRole = parseRole(body.role);
      if (!canCreateRole(currentUser.level, currentUser.role, targetRole)) {
        return forbidden(request, '当前账户无权创建该角色', apiErrorCodes.ROLE_NOT_ALLOWED);
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
          (candidate.role === UserRole.ADMIN && (candidate.level === 1 || candidate.level === 2)) ||
          (candidate.role === UserRole.SALES && candidate.level === 3)
        );
      });

      return NextResponse.json({ success: true, data: filtered });
    }

    // 获取用户列表 (管理员/销售)
    if (action === 'list') {
      const currentUser = await getCurrentUser(request);
      if (!currentUser || (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES)) {
        return forbidden(request, '无权限');
      }

      const scope = await getHierarchyScope(currentUser);

      const users = await db.user.findMany({
        where: {
          OR: [
            { id: { in: Array.from(scope.visibleIds) } },
            { level: currentUser.level },
          ],
        },
        select: { id: true, email: true, name: true, role: true, level: true, parentId: true, createdAt: true, createdById: true },
        orderBy: { createdAt: 'desc' }
      });

      return NextResponse.json({ success: true, data: users });
    }

    // 删除用户 (管理员/销售)
    if (action === 'delete') {
      const currentUser = await getCurrentUser(request);
      if (!currentUser || (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES)) {
        return forbidden(request, '无权限');
      }

      if (!userId) {
        return badRequest(request, '用户ID不能为空', apiErrorCodes.VALIDATION_ERROR);
      }

      if (userId === currentUser.id) {
        return badRequest(request, '不能删除自己', apiErrorCodes.SELF_ACTION_FORBIDDEN);
      }

      const target = await db.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, level: true },
      });
      if (!target) {
        return notFound(request, '用户不存在');
      }
      const scope = await getHierarchyScope(currentUser);
      if (!scope.descendantIds.has(target.id) || target.level <= currentUser.level) {
        return forbidden(request, '仅可删除下级用户', apiErrorCodes.ROLE_NOT_ALLOWED);
      }

      await db.$transaction(async (tx) => {
        // Reassign creator ownership to current operator before deleting user
        // to avoid foreign key violations on createdBy fields.
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
        await tx.user.delete({ where: { id: userId } });
      });
      return NextResponse.json({ success: true, message: '用户已删除' });
    }

    // 重置密码 (管理员/销售)
    if (action === 'reset-password') {
      const currentUser = await getCurrentUser(request);
      if (!currentUser || (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES)) {
        return forbidden(request, '无权限');
      }

      if (!userId || !password) {
        return badRequest(request, '用户ID和新密码不能为空', apiErrorCodes.VALIDATION_ERROR);
      }
      const target = await db.user.findUnique({
        where: { id: userId },
        select: { id: true, level: true },
      });
      if (!target) {
        return notFound(request, '用户不存在');
      }
      const scope = await getHierarchyScope(currentUser);
      if (!scope.descendantIds.has(target.id) || target.level <= currentUser.level) {
        return forbidden(request, '仅可重置下级用户密码', apiErrorCodes.ROLE_NOT_ALLOWED);
      }

      const hashedPassword = await hashPassword(password);
      await db.user.update({
        where: { id: userId },
        data: { password: hashedPassword }
      });

      return NextResponse.json({ success: true, message: '密码已重置' });
    }

    // 修改自己密码
    if (action === 'change-password') {
      const currentUser = await getCurrentUser(request);
      if (!currentUser) {
        return unauthorized(request, '未登录');
      }

      const oldPassword = typeof body.oldPassword === 'string' ? body.oldPassword : '';
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

      if (!oldPassword || !newPassword) {
        return badRequest(request, '旧密码和新密码不能为空', apiErrorCodes.VALIDATION_ERROR);
      }
      if (newPassword.length < 8) {
        return badRequest(request, '新密码至少8位', apiErrorCodes.PASSWORD_TOO_SHORT);
      }

      const userWithPassword = await db.user.findUnique({
        where: { id: currentUser.id },
        select: { id: true, password: true },
      });
      if (!userWithPassword) {
        return notFound(request, '用户不存在');
      }

      const oldValid = await verifyPassword(oldPassword, userWithPassword.password);
      if (!oldValid) {
        return badRequest(request, '旧密码错误', apiErrorCodes.INVALID_CREDENTIALS);
      }

      const hashedPassword = await hashPassword(newPassword);
      await db.user.update({
        where: { id: currentUser.id },
        data: { password: hashedPassword },
      });
      return NextResponse.json({ success: true, message: '密码修改成功' });
    }

    throw createApiError({
      code: apiErrorCodes.INVALID_ACTION,
      status: 400,
      message: '未知操作',
      detail: { action },
    });
  } catch (error) {
    console.error('Auth API error:', error);
    return toApiErrorResponse(error, {
      code: apiErrorCodes.INTERNAL_ERROR,
      status: 500,
      message: '服务器错误',
    }, request);
  }
}
