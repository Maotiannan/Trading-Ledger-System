import { Prisma, UserRole } from '@prisma/client';
import { hashPassword } from '@/lib/auth';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { createApiError } from '@/lib/api-error';
import { db } from '@/lib/db';
import { runInTransaction } from '@/lib/transaction';

export async function initializePrimaryAdmin(input: {
  email: string;
  password: string;
  name?: string | null;
}) {
  const email = String(input.email || '').trim();
  const password = String(input.password || '');
  if (!email || !password) {
    throw createApiError({ code: 'INIT_CONFIG_MISSING', status: 400, message: '缺少初始化管理员配置' });
  }

  const hashedPassword = await hashPassword(password);

  let existed = false;
  let user = null as null | { id: string; email: string; role: UserRole; level: number };

  try {
    user = await runInTransaction(async (tx) => {
      const existingAdmin = await tx.user.findUnique({
        where: { email },
        select: { id: true, level: true, parentId: true, createdById: true },
      });
      existed = Boolean(existingAdmin);
      return tx.user.upsert({
        where: { email },
        create: {
          email,
          password: hashedPassword,
          name: input.name || 'Admin',
          role: UserRole.ADMIN,
          level: 1,
          parentId: null,
          createdById: null,
        },
        update: {
          role: UserRole.ADMIN,
          level: 1,
          parentId: null,
          createdById: null,
        },
        select: { id: true, email: true, role: true, level: true },
      });
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }

    user = await runInTransaction(async (tx) => {
      existed = true;
      await tx.user.updateMany({
        where: { email },
        data: {
          role: UserRole.ADMIN,
          level: 1,
          parentId: null,
          createdById: null,
        },
      });
      return tx.user.findUnique({
        where: { email },
        select: { id: true, email: true, role: true, level: true },
      });
    });
  }

  if (!user) {
    throw createApiError({ code: 'INTERNAL_ERROR', status: 500, message: '管理员初始化失败' });
  }

  await recordAuditEvent({
    action: auditActions.USER_INIT,
    actorId: user.id,
    targetType: auditTargetTypes.USER,
    targetId: user.id,
    metadata: {
      email: user.email,
      existed,
      level: user.level,
      role: user.role,
    },
  });

  return {
    data: user,
    message: existed ? '管理员已存在' : '管理员初始化成功',
  };
}
