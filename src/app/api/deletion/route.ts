import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-auth';
import { createApiError } from '@/lib/api-error';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import { parseJsonRequest } from '@/lib/http-body';
import { enforceRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import {
  createDeletionRequest,
  listDeletionRequests,
  reviewDeletionRequest,
} from '@/lib/deletion-service';

// 获取删除申请列表
export const GET = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const requests = await listDeletionRequests(currentUser);
    return NextResponse.json({ success: true, data: requests });
  } catch (error) {
    logger.error('Get deletion requests error', error);
    return toApiErrorResponse(error, {
      code: 'INTERNAL_ERROR',
      status: 500,
      message: '服务器错误',
    }, request);
  }
});

// 创建/审批删除申请
export const POST = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const body = await parseJsonRequest<Record<string, unknown>>(request);
    const action = typeof body.action === 'string' ? body.action : '';
    const targetType = typeof body.targetType === 'string' ? body.targetType : '';
    const targetId = typeof body.targetId === 'string' ? body.targetId : '';
    const reason = typeof body.reason === 'string' ? body.reason : undefined;
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';

    await enforceRateLimit('deletion', request, { currentUser });

    // 发起删除申请
    if (action === 'request') {
      const deletionRequest = await createDeletionRequest({
        currentUser,
        targetType,
        targetId,
        reason,
      });
      return NextResponse.json({ success: true, data: deletionRequest });
    }

    // 审批删除申请（管理员）
    if (action === 'approve' || action === 'reject') {
      const result = await reviewDeletionRequest({
        currentUser,
        action,
        requestId,
      });
      return createApiSuccessResponse({ message: result.message }, request);
    }

    throw createApiError({
      code: 'INVALID_ACTION',
      status: 400,
      message: '未知操作',
      detail: { action },
    });
  } catch (error) {
    logger.error('Deletion API error', error);
    return toApiErrorResponse(error, {
      code: 'INTERNAL_ERROR',
      status: 500,
      message: '服务器错误',
    }, request);
  }
});
