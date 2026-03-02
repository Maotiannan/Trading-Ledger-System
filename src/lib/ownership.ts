import { NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import type { CurrentUser } from '@/lib/request-auth';
import { getHierarchyScope } from '@/lib/user-hierarchy';

export function isAdmin(user: CurrentUser): boolean {
  return user.role === UserRole.ADMIN;
}

export function isManager(user: CurrentUser): boolean {
  return user.role === UserRole.ADMIN || user.role === UserRole.SALES;
}

export function canAccessOwnedResource(ownerId: string, user: CurrentUser): boolean {
  return ownerId === user.id;
}

export async function canAccessOwnedResourceAsync(ownerId: string, user: CurrentUser): Promise<boolean> {
  const scope = await getHierarchyScope(user);
  return scope.visibleIds.has(ownerId);
}

export function forbiddenOwnershipResponse(message = '无权操作该资源'): NextResponse {
  return NextResponse.json({ success: false, error: message }, { status: 403 });
}
