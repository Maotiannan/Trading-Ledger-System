import { withRole } from '@/lib/route-auth';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { parseJsonRequest } from '@/lib/http-body';
import { listRecoveryEntries, restoreRecoveryEntry } from '@/lib/recovery-service';

export const GET = withRole('ADMIN', async (request, user) => {
  try {
    return createApiSuccessResponse({ data: await listRecoveryEntries(user) }, request);
  } catch (error) {
    return toApiErrorResponse(error, { code: 'INTERNAL_ERROR', status: 500, message: '恢复区读取失败' }, request);
  }
});

export const POST = withRole('ADMIN', async (request, user) => {
  try {
    const body = await parseJsonRequest<{ id: string }>(request);
    return createApiSuccessResponse({ data: await restoreRecoveryEntry(user, String(body.id || '')) }, request);
  } catch (error) {
    return toApiErrorResponse(error, { code: 'CONFLICT', status: 409, message: '无法恢复：关联已变化或存在重复记录' }, request);
  }
});
