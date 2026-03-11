import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { validateUser } from '@/lib/auth';
import { UserRole } from '@prisma/client';
import { type ApiErrorCode, apiErrorCodes, createApiError } from '@/lib/api-error';
import { createApiErrorResponse, toApiErrorResponse } from '@/lib/api-error-response';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import { getCurrentUser } from '@/lib/request-auth';
import { clearSessionCookie, createSessionToken, setSessionCookie } from '@/lib/session';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import {
  canCreateRole,
  changeCurrentUserPassword,
  createManagedUser,
  deleteManagedUser,
  parseManagedRole,
  resetManagedUserPassword,
  updateManagedUserRole,
} from '@/lib/auth-service';

const roleRank: Record<UserRole, number> = {
  [UserRole.ADMIN]: 4,
  [UserRole.SALES]: 3,
  [UserRole.USER]: 2,
};

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

      const response = createApiSuccessResponse({ data: user, message: '登录成功' }, request);
      const token = createSessionToken(user.id);
      setSessionCookie(response, token);
      return response;
    }

    if (action === 'logout') {
      const response = createApiSuccessResponse({ message: '已退出登录' }, request);
      clearSessionCookie(response);
      return response;
    }

    // 获取当前用户
    if (action === 'me') {
      const user = await getCurrentUser(request);
      if (!user) {
        return unauthorized(request, '未登录');
      }
      return createApiSuccessResponse({ data: user, message: '当前用户信息已加载' }, request);
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

      const result = await createManagedUser(currentUser, {
        email,
        password,
        name,
        role: body.role,
        parentId: typeof body.parentId === 'string' ? body.parentId : null,
      });

      return createApiSuccessResponse(result, request);
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
      const result = await updateManagedUserRole(currentUser, { userId, role: body.role });
      return createApiSuccessResponse(result, request);
    }

    // 创建用户时可选的上级列表
    if (action === 'parent-options') {
      const currentUser = await getCurrentUser(request);
      if (!currentUser || (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES)) {
        return forbidden(request, '无权限');
      }

      const targetRole = parseManagedRole(body.role);
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

      return createApiSuccessResponse({ data: filtered, message: `可选上级账户已加载，共 ${filtered.length} 个候选账号` }, request);
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

      return createApiSuccessResponse({ data: users, message: `用户列表已加载，共 ${users.length} 个账号` }, request);
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

      const result = await deleteManagedUser(currentUser, userId);
      return createApiSuccessResponse(result, request);
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
      const result = await resetManagedUserPassword(currentUser, { userId, password });
      return createApiSuccessResponse(result, request);
    }

    // 修改自己密码
    if (action === 'change-password') {
      const currentUser = await getCurrentUser(request);
      if (!currentUser) {
        return unauthorized(request, '未登录');
      }

      const result = await changeCurrentUserPassword(currentUser, {
        oldPassword: typeof body.oldPassword === 'string' ? body.oldPassword : '',
        newPassword: typeof body.newPassword === 'string' ? body.newPassword : '',
      });
      return createApiSuccessResponse(result, request);
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
