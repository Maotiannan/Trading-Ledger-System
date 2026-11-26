import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isApiError } from '@/lib/api-error';
import { enforceRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export const COLLABORATION_CREDIT_SCOPE = 'credit-records:read';
const CONTRACT = 'credit-records/1.0.0';

export class CollaborationCreditError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

function readCredential(request: NextRequest): string {
  const expected = process.env.COLLABORATION_CREDIT_READ_TOKEN?.trim();
  if (!expected || expected.length < 32) {
    throw new CollaborationCreditError(503, 'SERVICE_UNAVAILABLE', 'Credit source service is temporarily unavailable.');
  }
  const header = request.headers.get('authorization');
  if (!header) throw new CollaborationCreditError(401, 'AUTH_REQUIRED', 'A dedicated service bearer token is required.');
  const candidate = /^Bearer\s+(\S+)$/i.exec(header)?.[1] || '';
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!candidate || !timingSafeEqual(digest(candidate), digest(expected))) {
    throw new CollaborationCreditError(401, 'AUTH_INVALID', 'Invalid service credential.');
  }
  return expected;
}

// A fixed read scope, not an employee login or permission delegated by a browser.
export async function withCollaborationCreditRead(
  request: NextRequest,
  read: (cursorSecret: string) => Promise<unknown>,
): Promise<NextResponse> {
  const startedAt = Date.now();
  const endpoint = new URL(request.url).pathname.replace(/\/$/, '').endsWith('/credit-records') ? 'list' : 'detail';
  const headers = { 'Cache-Control': 'no-store', 'X-Collaboration-Contract': CONTRACT };
  try {
    const secret = readCredential(request);
    await enforceRateLimit('excelLookup', request, { identityHint: 'collaboration-credit-records-read-v1' });
    const result = await read(secret);
    logger.info('collaboration.credit.read', { scope: COLLABORATION_CREDIT_SCOPE, endpoint, status: 200, durationMs: Date.now() - startedAt });
    return NextResponse.json(result, { headers });
  } catch (error) {
    const rateLimited = isApiError(error) && error.status === 429;
    const known = error instanceof CollaborationCreditError;
    const status = rateLimited ? 429 : known ? error.status : 503;
    const retryAfterMs = rateLimited
      ? Math.max(1, Math.ceil(Number((error.detail as { retryAfterMs?: number })?.retryAfterMs) || 1000)) : undefined;
    const body = { error: {
      code: rateLimited ? 'RATE_LIMITED' : known ? error.code : 'SERVICE_UNAVAILABLE',
      message: rateLimited ? 'Too many credit source reads. Please retry later.'
        : known ? error.message : 'Credit source service is temporarily unavailable.',
      ...(retryAfterMs ? { retryAfterMs } : {}),
    } };
    logger.warn('collaboration.credit.read', {
      scope: COLLABORATION_CREDIT_SCOPE, endpoint, status, code: body.error.code, durationMs: Date.now() - startedAt,
      ...(!known && !rateLimited ? { cause: error instanceof Error ? error.name : 'UnknownError' } : {}),
    });
    return NextResponse.json(body, { status, headers: {
      ...headers, ...(retryAfterMs ? { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } : {}),
    } });
  }
}
