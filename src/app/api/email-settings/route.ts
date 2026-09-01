import { NextRequest } from 'next/server';
import { UserRole } from '@prisma/client';
import { apiErrorCodes } from '@/lib/api-error';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import {
  ensureDefaultEmailTemplates,
  getEmailSettings,
  listActiveEmailTemplates,
  previewEmailTemplate,
  saveEmailTemplate,
  updateEmailSettings,
} from '@/lib/email/email-settings';
import { EMAIL_NOTIFICATION_TYPES } from '@/lib/email/email-types';
import { getEmailTemplateVariableCatalog } from '@/lib/email/email-template-catalog';
import { parseJsonRequest } from '@/lib/http-body';
import { logger } from '@/lib/logger';
import { withRole } from '@/lib/route-auth';

function text(value: unknown): string {
  return String(value ?? '').trim();
}

export const GET = withRole(UserRole.ADMIN, async (request: NextRequest) => {
  try {
    await ensureDefaultEmailTemplates();
    const [settings, templates] = await Promise.all([
      getEmailSettings(),
      listActiveEmailTemplates(),
    ]);
    return createApiSuccessResponse({
      settings,
      templates,
      variableCatalog: Object.fromEntries(
        EMAIL_NOTIFICATION_TYPES.map((type) => [type, getEmailTemplateVariableCatalog(type)]),
      ),
      apiKeyConfigured: Boolean(process.env.RESEND_API_KEY?.trim()),
      webhookSecretConfigured: Boolean(process.env.RESEND_WEBHOOK_SECRET?.trim()),
      message: '邮件通知设置已加载',
    }, request);
  } catch (error) {
    logger.error('Email settings GET error', error);
    return toApiErrorResponse(error, {
      code: apiErrorCodes.INTERNAL_ERROR,
      status: 500,
      message: '邮件通知设置加载失败',
    }, request);
  }
}, '只有管理员可以管理邮件通知');

export const POST = withRole(UserRole.ADMIN, async (request: NextRequest, currentUser) => {
  try {
    const body = await parseJsonRequest<Record<string, unknown>>(request);
    const action = text(body.action);
    if (action === 'save-settings') {
      return createApiSuccessResponse(await updateEmailSettings(currentUser, body.settings), request);
    }
    if (action === 'save-template') {
      return createApiSuccessResponse(await saveEmailTemplate(currentUser, body.template), request);
    }
    if (action === 'preview-template') {
      return createApiSuccessResponse(await previewEmailTemplate(currentUser, body.template), request);
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
    logger.error('Email settings POST error', error);
    return toApiErrorResponse(error, {
      code: apiErrorCodes.INTERNAL_ERROR,
      status: 500,
      message: '邮件通知设置保存失败',
    }, request);
  }
}, '只有管理员可以管理邮件通知');
