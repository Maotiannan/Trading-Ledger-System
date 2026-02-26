import { NextRequest } from 'next/server';
import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { getSessionCookieName, verifySessionToken } from '@/lib/session';

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
}

export async function getCurrentUser(request: NextRequest): Promise<CurrentUser | null> {
  const token = request.cookies.get(getSessionCookieName())?.value;
  if (!token) return null;

  const payload = verifySessionToken(token);
  if (!payload) return null;

  return db.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, name: true, role: true },
  });
}
