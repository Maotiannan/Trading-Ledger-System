import { UserRole } from '@prisma/client';
import type { NextRequest } from 'next/server';

import { createApiError } from '@/lib/api-error';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import { parseJsonRequest } from '@/lib/http-body';
import { safeMuContractErrorCode, toMuContractApiErrorResponse } from '@/lib/integrations/mu-contract-api-error';
import {
  applyMuContractReconcile,
  previewMuContractReconcile,
} from '@/lib/integrations/mu-contract-reconcile-service';
import { runMuContractSyncNow } from '@/lib/integrations/mu-contract-sync-service';
import { logger } from '@/lib/logger';
import { withRole } from '@/lib/route-auth';

type MuContractAdminAction =
  | { action: 'sync-now' }
  | { action: 'preview-reconcile' }
  | { action: 'apply-reconcile'; previewId: string };

function assertActionCompleted(result: { status: string }): void {
  if (result.status !== 'running') return;
  throw createApiError({
    code: 'CONFLICT',
    status: 409,
    message: '另一个同步任务正在运行，本次操作未完成，请稍后重试',
  });
}

function parseAction(body: Record<string, unknown>): MuContractAdminAction {
  const action = typeof body.action === 'string' ? body.action : '';
  if (action === 'sync-now' || action === 'preview-reconcile') return { action };
  if (action === 'apply-reconcile') {
    const previewId = typeof body.previewId === 'string' ? body.previewId.trim() : '';
    if (!previewId) {
      throw createApiError({
        code: 'BAD_REQUEST',
        status: 400,
        message: '请选择有效的 Full Reconcile 预览',
      });
    }
    return { action, previewId };
  }
  throw createApiError({
    code: 'INVALID_ACTION',
    status: 400,
    message: '未知操作',
  });
}

export const POST = withRole(UserRole.ADMIN, async (request: NextRequest, currentUser) => {
  try {
    const body = await parseJsonRequest<Record<string, unknown>>(request);
    const input = parseAction(body);
    if (input.action === 'sync-now') {
      const data = await runMuContractSyncNow({ actorId: currentUser.id });
      assertActionCompleted(data);
      return createApiSuccessResponse({ data, message: 'MU Contract 增量同步已完成' }, request);
    }
    if (input.action === 'preview-reconcile') {
      const data = await previewMuContractReconcile(currentUser.id);
      return createApiSuccessResponse({ data, message: 'Full Reconcile 预览已生成' }, request);
    }

    const data = await applyMuContractReconcile(currentUser.id, input.previewId);
    assertActionCompleted(data);
    return createApiSuccessResponse({ data, message: 'Full Reconcile 已完成' }, request);
  } catch (error) {
    logger.error('MU Contract administrator action failed', { code: safeMuContractErrorCode(error) });
    return toMuContractApiErrorResponse(error, request);
  }
});
