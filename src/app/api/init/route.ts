import { NextResponse } from 'next/server';
import { apiErrorCodes } from '@/lib/api-error';
import { createApiErrorResponse, toApiErrorResponse } from '@/lib/api-error-response';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import { initializePrimaryAdmin } from '@/lib/init-service';
import { logger } from '@/lib/logger';

// 初始化默认管理员账户
export async function POST(request: Request) {
  try {
    const enableInit = process.env.ENABLE_INIT_ROUTE === 'true';
    if (!enableInit) {
      return createApiErrorResponse({ code: apiErrorCodes.INIT_DISABLED, status: 403, message: '初始化接口已禁用' }, request);
    }

    const initToken = process.env.INIT_ADMIN_TOKEN;
    const requestToken = request.headers.get('x-init-token');
    if (!initToken || requestToken !== initToken) {
      return createApiErrorResponse({ code: apiErrorCodes.INIT_TOKEN_INVALID, status: 401, message: '初始化令牌无效' }, request);
    }

    const adminEmail = process.env.INIT_ADMIN_EMAIL || 'admin@example.com';
    const adminPassword = process.env.INIT_ADMIN_PASSWORD || '';
    if (!adminEmail || !adminPassword) {
      return createApiErrorResponse({ code: apiErrorCodes.INIT_CONFIG_MISSING, status: 400, message: '缺少初始化管理员配置' }, request);
    }

    const result = await initializePrimaryAdmin({
      email: adminEmail,
      password: adminPassword,
      name: 'Admin',
    });
    return createApiSuccessResponse({ message: result.message, data: result.data }, request);
  } catch (error) {
    logger.error('Init error', error);
    return toApiErrorResponse(error, {
      code: apiErrorCodes.INTERNAL_ERROR,
      status: 500,
      message: 'Init failed',
    }, request);
  }
}
