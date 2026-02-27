import { NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import type { CurrentUser } from '@/lib/request-auth';

export function isAdmin(user: CurrentUser): boolean {
  return user.role === UserRole.ADMIN;
}

export function canAccessOwnedResource(ownerId: string, user: CurrentUser): boolean {
  return isAdmin(user) || ownerId === user.id;
}

export function forbiddenOwnershipResponse(message = '无权操作该资源'): NextResponse {
  return NextResponse.json({ success: false, error: message }, { status: 403 });
}
