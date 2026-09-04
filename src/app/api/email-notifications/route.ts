import { NextRequest } from 'next/server';
import { UserRole } from '@prisma/client';
import { apiErrorCodes } from '@/lib/api-error';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import {
  approveEmailNotifications,
  cancelEmailNotification,
  createCorrectionNotification,
  listEmailDeliveryAttempts,
  listEmailNotifications,
  previewEmailNotification,
  retryEmailNotification,
} from '@/lib/email/email-notification-service';
import { parseJsonRequest } from '@/lib/http-body';
import { logger } from '@/lib/logger';
import { withRole } from '@/lib/route-auth';

function queryInput(request: NextRequest): Record<string, unknown> {
  const params = request.nextUrl.searchParams;
  return {
    page: params.get('page') || undefined,
    pageSize: params.get('pageSize') || undefined,
    search: params.get('search') || undefined,
    types: params.getAll('type'),
    statuses: params.getAll('status'),
    dateFrom: params.get('dateFrom') || undefined,
    dateTo: params.get('dateTo') || undefined,
  };
}

export const GET = withRole(UserRole.ADMIN, async (request: NextRequest, currentUser) => {
  try {
    if (request.nextUrl.searchParams.get('action') === 'attempts') {
      return createApiSuccessResponse(await listEmailDeliveryAttempts(currentUser, {
        notificationId: request.nextUrl.searchParams.get('notificationId'),
      }), request);
    }
    return createApiSuccessResponse(await listEmailNotifications(currentUser, queryInput(request)), request);
  } catch (error) {
    logger.error('Email notifications GET error', error);
    return toApiErrorResponse(error, {
      code: apiErrorCodes.INTERNAL_ERROR,
      status: 500,
      message: '邮件任务加载失败',
    }, request);
  }
}, '只有管理员可以管理客户邮件');

export const POST = withRole(UserRole.ADMIN, async (request: NextRequest, currentUser) => {
  try {
    const body = await parseJsonRequest<Record<string, unknown>>(request);
    const action = String(body.action || '').trim();
    if (action === 'preview') {
      return createApiSuccessResponse(await previewEmailNotification(currentUser, {
        notificationId: body.notificationId,
        language: body.language,
      }), request);
    }
    if (action === 'approve') {
      return createApiSuccessResponse(await approveEmailNotifications(currentUser, {
        notificationIds: body.notificationIds,
      }), request);
    }
    if (action === 'cancel') {
      return createApiSuccessResponse(await cancelEmailNotification(currentUser, {
        notificationId: body.notificationId,
      }), request);
    }
    if (action === 'retry') {
      return createApiSuccessResponse(await retryEmailNotification(currentUser, {
        notificationId: body.notificationId,
        confirmUncertain: body.confirmUncertain,
      }), request);
    }
    if (action === 'create-correction') {
      return createApiSuccessResponse(await createCorrectionNotification(currentUser, {
        notificationId: body.notificationId,
      }), request);
    }
    return toApiErrorResponse({
      code: apiErrorCodes.INVALID_ACTION,
      status: 400,
      message: '未知操作',
      detail: { action },
    }, {
      code: apiErrorCodes.INVALID_ACTION,
      status: 400,
      message: '未知操作',
    }, request);
  } catch (error) {
    logger.error('Email notifications POST error', error);
    return toApiErrorResponse(error, {
      code: apiErrorCodes.INTERNAL_ERROR,
      status: 500,
      message: '邮件任务操作失败',
    }, request);
  }
}, '只有管理员可以管理客户邮件');
