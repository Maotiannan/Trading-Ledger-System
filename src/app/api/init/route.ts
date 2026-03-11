import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { Prisma, UserRole } from '@prisma/client';
import { apiErrorCodes } from '@/lib/api-error';
import { createApiErrorResponse, toApiErrorResponse } from '@/lib/api-error-response';

// 初始化默认管理员账户
export async function POST(request: Request) {
  try {
    const enableInit = process.env.ENABLE_INIT_ROUTE === 'true';
    if (!enableInit) {
      return createApiErrorResponse({ code: apiErrorCodes.INIT_DISABLED, status: 403, message: '初始化接口已禁用' });
    }

    const initToken = process.env.INIT_ADMIN_TOKEN;
    const requestToken = request.headers.get('x-init-token');
    if (!initToken || requestToken !== initToken) {
      return createApiErrorResponse({ code: apiErrorCodes.INIT_TOKEN_INVALID, status: 401, message: '初始化令牌无效' });
    }

    const adminEmail = process.env.INIT_ADMIN_EMAIL || 'admin@example.com';
    const adminPassword = process.env.INIT_ADMIN_PASSWORD || '12345678';
    if (!adminEmail || !adminPassword) {
      return createApiErrorResponse({ code: apiErrorCodes.INIT_CONFIG_MISSING, status: 400, message: '缺少初始化管理员配置' });
    }

    const existingAdmin = await db.user.findUnique({
      where: { email: adminEmail },
      select: { id: true, level: true, parentId: true, createdById: true },
    });

    const hashedPassword = await hashPassword(adminPassword);
    await db.user.upsert({
      where: { email: adminEmail },
      create: {
        email: adminEmail,
        password: hashedPassword!,
        name: 'Admin',
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
    });

    return NextResponse.json({ success: true, message: existingAdmin ? '管理员已存在' : '管理员初始化成功' });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      await db.user.updateMany({
        where: { email: process.env.INIT_ADMIN_EMAIL || 'admin@example.com' },
        data: {
          role: UserRole.ADMIN,
          level: 1,
          parentId: null,
          createdById: null,
        },
      });
      return NextResponse.json({ success: true, message: '管理员已存在' });
    }
    console.error('Init error:', error);
    return toApiErrorResponse(error, {
      code: apiErrorCodes.INTERNAL_ERROR,
      status: 500,
      message: 'Init failed',
    });
  }
}
