import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-auth';
import { createApiError } from '@/lib/api-error';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { createApiSuccessResponse } from '@/lib/api-success-response';
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
    console.error('Get deletion requests error:', error);
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
    const body = await request.json();
    const { action, targetType, targetId, reason, requestId } = body;

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
    console.error('Deletion API error:', error);
    return toApiErrorResponse(error, {
      code: 'INTERNAL_ERROR',
      status: 500,
      message: '服务器错误',
    }, request);
  }
});
