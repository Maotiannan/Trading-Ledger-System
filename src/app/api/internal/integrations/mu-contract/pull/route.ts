import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { safeMuContractErrorCode, toMuContractApiErrorResponse } from '@/lib/integrations/mu-contract-api-error';
import { runScheduledMuContractSync } from '@/lib/integrations/mu-contract-sync-service';
import { logger } from '@/lib/logger';
import { requireProductionSecret } from '@/lib/security-config';

function matchesSecret(candidate: string | null, expected: string): boolean {
  if (!candidate || !expected) return false;
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return candidateBuffer.length === expectedBuffer.length
    && timingSafeEqual(candidateBuffer, expectedBuffer);
}

export async function POST(request: Request) {
  try {
    const expectedToken = requireProductionSecret(
      'MAINTENANCE_JOB_TOKEN',
      process.env.MAINTENANCE_JOB_TOKEN,
    );
    if (!matchesSecret(request.headers.get('x-maintenance-token'), expectedToken)) {
      return NextResponse.json(
        { success: false, error: 'UNAUTHORIZED', code: 'AUTH_REQUIRED', detail: null },
        { status: 401 },
      );
    }

    const data = await runScheduledMuContractSync();
    return NextResponse.json({
      success: true,
      data,
      message: 'MU Contract scheduled synchronization completed',
    });
  } catch (error) {
    logger.error('MU Contract scheduled pull failed', { code: safeMuContractErrorCode(error) });
    return toMuContractApiErrorResponse(error, request);
  }
}
