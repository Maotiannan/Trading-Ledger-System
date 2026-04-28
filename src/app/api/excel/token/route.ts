import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/route-auth';
import { createApiError, apiErrorCodes } from '@/lib/api-error';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import { parseJsonRequest } from '@/lib/http-body';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import {
  generateExcelApiToken,
  listExcelApiTokens,
  revokeExcelApiToken,
} from '@/lib/excel-token-service';

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const GET = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const data = await listExcelApiTokens(currentUser);
    await recordAuditEvent({
      action: auditActions.EXCEL_TOKEN_LIST,
      actorId: currentUser.id,
      targetType: auditTargetTypes.EXCEL_API_TOKEN,
      metadata: { count: data.length },
    });
    return createApiSuccessResponse({ data, message: 'Excel API令牌已加载' }, request);
  } catch (error) {
    return toApiErrorResponse(error, {
      code: apiErrorCodes.INTERNAL_ERROR,
      status: 500,
      message: '服务器错误',
    }, request);
  }
});

export const POST = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const body = await parseJsonRequest<Record<string, unknown>>(request).catch(() => ({} as Record<string, unknown>));
    const action = trimString(body.action);

    if (action === 'generate') {
      const result = await generateExcelApiToken(currentUser, trimString(body.name) || 'Excel ML');
      await recordAuditEvent({
        action: auditActions.EXCEL_TOKEN_GENERATE,
        actorId: currentUser.id,
        targetType: auditTargetTypes.EXCEL_API_TOKEN,
        targetId: result.tokenInfo.id,
        metadata: {
          name: result.tokenInfo.name,
          tokenPrefix: result.tokenInfo.tokenPrefix,
        },
      });
      return createApiSuccessResponse({ data: result, message: 'Excel API令牌已生成' }, request);
    }

    if (action === 'revoke') {
      const tokenId = trimString(body.id) || trimString(body.tokenId);
      const result = await revokeExcelApiToken(currentUser, tokenId);
      await recordAuditEvent({
        action: auditActions.EXCEL_TOKEN_REVOKE,
        actorId: currentUser.id,
        targetType: auditTargetTypes.EXCEL_API_TOKEN,
        targetId: tokenId,
      });
      return createApiSuccessResponse(result, request);
    }

    throw createApiError({
      code: apiErrorCodes.INVALID_ACTION,
      status: 400,
      message: '未知操作',
      detail: { action },
    });
  } catch (error) {
    return toApiErrorResponse(error, {
      code: apiErrorCodes.INTERNAL_ERROR,
      status: 500,
      message: '服务器错误',
    }, request);
  }
});
