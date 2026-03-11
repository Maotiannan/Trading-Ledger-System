import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { apiErrorCodes } from '@/lib/api-error';
import { createApiErrorResponse } from '@/lib/api-error-response';
import { CurrentUser, getCurrentUser } from '@/lib/request-auth';

type AuthedHandler = (request: NextRequest, currentUser: CurrentUser) => Promise<NextResponse>;

export function withAuth(handler: AuthedHandler) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return createApiErrorResponse({
        code: apiErrorCodes.AUTH_REQUIRED,
        status: 401,
        message: '未登录',
      });
    }
    return handler(request, currentUser);
  };
}

export function withRole(role: UserRole | UserRole[], handler: AuthedHandler, message = '无权限') {
  return withAuth(async (request, currentUser) => {
    const allowed = Array.isArray(role) ? role : [role];
    if (!allowed.includes(currentUser.role)) {
      return createApiErrorResponse({
        code: apiErrorCodes.FORBIDDEN,
        status: 403,
        message,
      });
    }
    return handler(request, currentUser);
  });
}
