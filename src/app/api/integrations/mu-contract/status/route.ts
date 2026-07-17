import { UserRole } from '@prisma/client';
import type { NextRequest } from 'next/server';

import { toMuContractApiErrorResponse, safeMuContractErrorCode } from '@/lib/integrations/mu-contract-api-error';
import { getMuContractSyncStatus } from '@/lib/integrations/mu-contract-sync-service';
import { logger } from '@/lib/logger';
import { withRole } from '@/lib/route-auth';
import { createApiSuccessResponse } from '@/lib/api-success-response';

export const GET = withRole(UserRole.ADMIN, async (request: NextRequest) => {
  try {
    const data = await getMuContractSyncStatus();
    return createApiSuccessResponse(
      { data, message: 'MU Contract 同步状态已加载' },
      request,
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    logger.error('MU Contract status request failed', { code: safeMuContractErrorCode(error) });
    return toMuContractApiErrorResponse(error, request);
  }
});
