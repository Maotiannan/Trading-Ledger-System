import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/route-auth';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import { parseJsonRequest } from '@/lib/http-body';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { logger } from '@/lib/logger';
import {
  attachPaymentAgentFile,
  createPaymentAgent,
  deletePaymentAgent,
  deletePaymentAgentFile,
  listPaymentAgents,
  updatePaymentAgent,
} from '@/lib/payment-agent-service';

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const GET = withAuth(async (request, currentUser) => {
  try {
    const search = request.nextUrl.searchParams.get('search') || '';
    const data = await listPaymentAgents(currentUser, { search });
    return createApiSuccessResponse({ data, message: '付款代理已加载' }, request);
  } catch (error) {
    logger.error('Payment agent GET error', error);
    return toApiErrorResponse(error, {
      code: 'INTERNAL_ERROR',
      status: 500,
      message: '服务器错误',
    }, request);
  }
});

export const POST = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const body = await parseJsonRequest<Record<string, unknown>>(request).catch(() => ({} as Record<string, unknown>));
    const action = trimString(body.action);

    if (action === 'create') {
      const result = await createPaymentAgent(currentUser, {
        companyName: trimString(body.companyName),
        companyAddress: trimString(body.companyAddress) || null,
        contactName: trimString(body.contactName) || null,
        contactPhone: trimString(body.contactPhone) || null,
      });
      return createApiSuccessResponse(result, request);
    }

    if (action === 'update') {
      const result = await updatePaymentAgent(currentUser, trimString(body.agentId), {
        companyName: trimString(body.companyName),
        companyAddress: trimString(body.companyAddress) || null,
        contactName: trimString(body.contactName) || null,
        contactPhone: trimString(body.contactPhone) || null,
      });
      return createApiSuccessResponse(result, request);
    }

    if (action === 'delete') {
      const result = await deletePaymentAgent(currentUser, trimString(body.agentId));
      return createApiSuccessResponse(result, request);
    }

    if (action === 'attach-file') {
      const size = Number(body.size);
      const result = await attachPaymentAgentFile({
        currentUser,
        agentId: trimString(body.agentId),
        path: trimString(body.path),
        name: trimString(body.name),
        mimeType: trimString(body.mimeType),
        size: Number.isFinite(size) ? size : 0,
      });
      return createApiSuccessResponse(result, request);
    }

    if (action === 'delete-file') {
      const result = await deletePaymentAgentFile(currentUser, trimString(body.fileId));
      return createApiSuccessResponse(result, request);
    }

    throw new Error('未知操作');
  } catch (error) {
    logger.error('Payment agent POST error', error);
    return toApiErrorResponse(error, {
      code: 'INTERNAL_ERROR',
      status: 500,
      message: '服务器错误',
    }, request);
  }
});
