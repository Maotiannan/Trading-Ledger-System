import { NextRequest, NextResponse } from 'next/server';
import { validateUser } from '@/lib/auth';
import { UserRole } from '@prisma/client';
import { type ApiErrorCode, apiErrorCodes, createApiError } from '@/lib/api-error';
import { createApiErrorResponse, toApiErrorResponse } from '@/lib/api-error-response';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import { getCurrentUser } from '@/lib/request-auth';
import { clearSessionCookie, createSessionToken, setSessionCookie } from '@/lib/session';
import {
  changeCurrentUserPassword,
  createManagedUser,
  deleteManagedUser,
  resetManagedUserPassword,
  updateManagedUserRole,
} from '@/lib/auth-service';
import {
  getCurrentAccount,
  listManagedUserParentOptions,
  listManagedUsers,
} from '@/lib/auth-read-service';

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
      const result = await getCurrentAccount(user);
      return createApiSuccessResponse(result, request);
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
      const result = await listManagedUserParentOptions(currentUser, body.role);
      return createApiSuccessResponse(result, request);
    }

    // 获取用户列表 (管理员/销售)
    if (action === 'list') {
      const currentUser = await getCurrentUser(request);
      if (!currentUser || (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES)) {
        return forbidden(request, '无权限');
      }
      const result = await listManagedUsers(currentUser);
      return createApiSuccessResponse(result, request);
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
