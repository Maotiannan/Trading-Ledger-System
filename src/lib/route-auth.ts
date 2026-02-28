import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { CurrentUser, getCurrentUser } from '@/lib/request-auth';

type AuthedHandler = (request: NextRequest, currentUser: CurrentUser) => Promise<NextResponse>;

export function withAuth(handler: AuthedHandler) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }
    return handler(request, currentUser);
  };
}

export function withRole(role: UserRole | UserRole[], handler: AuthedHandler, message = '无权限') {
  return withAuth(async (request, currentUser) => {
    const allowed = Array.isArray(role) ? role : [role];
    if (!allowed.includes(currentUser.role)) {
      return NextResponse.json({ success: false, error: message }, { status: 403 });
    }
    return handler(request, currentUser);
  });
}
