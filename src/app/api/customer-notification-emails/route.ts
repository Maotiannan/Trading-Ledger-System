import { NextRequest } from 'next/server';
import { apiErrorCodes } from '@/lib/api-error';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import {
  addCustomerNotificationEmail,
  deleteCustomerNotificationEmail,
  listCustomerNotificationEmails,
  setPrimaryCustomerNotificationEmail,
  updateCustomerNotificationEmail,
  updateCustomerNotificationLanguage,
} from '@/lib/email/customer-notification-email-service';
import { parseJsonRequest } from '@/lib/http-body';
import { logger } from '@/lib/logger';
import { withAuth } from '@/lib/route-auth';
import { toApiErrorResponse } from '@/lib/api-error-response';

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export const GET = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const customerId = text(new URL(request.url).searchParams.get('customerId'));
    const result = await listCustomerNotificationEmails(currentUser, customerId);
    return createApiSuccessResponse(result, request);
  } catch (error) {
    logger.error('Customer notification email GET error', error);
    return toApiErrorResponse(error, {
      code: apiErrorCodes.INTERNAL_ERROR,
      status: 500,
      message: '服务器错误',
    }, request);
  }
});

export const POST = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const body = await parseJsonRequest<Record<string, unknown>>(request);
    const action = text(body.action);
    const customerId = text(body.customerId);

    if (action === 'add') {
      return createApiSuccessResponse(
        await addCustomerNotificationEmail(currentUser, customerId, body.email),
        request,
      );
    }
    if (action === 'update') {
      return createApiSuccessResponse(
        await updateCustomerNotificationEmail(currentUser, customerId, body.emailId, body.email),
        request,
      );
    }
    if (action === 'delete') {
      return createApiSuccessResponse(
        await deleteCustomerNotificationEmail(currentUser, customerId, body.emailId),
        request,
      );
    }
    if (action === 'set-primary') {
      return createApiSuccessResponse(
        await setPrimaryCustomerNotificationEmail(currentUser, customerId, body.emailId),
        request,
      );
    }
    if (action === 'update-language') {
      return createApiSuccessResponse(
        await updateCustomerNotificationLanguage(currentUser, customerId, body.language),
        request,
      );
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
    logger.error('Customer notification email POST error', error);
    return toApiErrorResponse(error, {
      code: apiErrorCodes.INTERNAL_ERROR,
      status: 500,
      message: '服务器错误',
    }, request);
  }
});
