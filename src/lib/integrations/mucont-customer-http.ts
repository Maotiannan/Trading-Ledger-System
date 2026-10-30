import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isApiError } from '@/lib/api-error';
import { enforceRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export class MucontCustomerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly customerId?: string,
  ) {
    super(message);
  }
}

function readCredential(request: NextRequest): string {
  const expected = process.env.MUCONT_CUSTOMERS_READ_TOKEN?.trim();
  if (!expected || expected.length < 32) {
    throw new MucontCustomerError(503, 'SERVICE_UNAVAILABLE', 'Customer service is temporarily unavailable.');
  }
  const header = request.headers.get('authorization');
  if (!header) {
    throw new MucontCustomerError(401, 'AUTH_REQUIRED', 'A service bearer token is required.');
  }
  const candidate = /^Bearer\s+(\S+)$/i.exec(header)?.[1] || '';
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!candidate || !timingSafeEqual(digest(candidate), digest(expected))) {
    throw new MucontCustomerError(401, 'AUTH_INVALID', 'Invalid service credential.');
  }
  return expected;
}

// This credential grants only these two GETs, independent of staff accounts and ownership.
export async function withMucontCustomerRead(
  request: NextRequest,
  read: (cursorSecret: string) => Promise<unknown>,
): Promise<NextResponse> {
  const startedAt = Date.now();
  const endpoint = new URL(request.url).pathname.endsWith('/options') ? 'options' : 'profile';
  try {
    const secret = readCredential(request);
    await enforceRateLimit('excelLookup', request, { identityHint: 'mucont-customer-read-v1' });
    const result = await read(secret);
    logger.info('mucont.customer.read', { endpoint, status: 200, durationMs: Date.now() - startedAt });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const rateLimited = isApiError(error) && error.status === 429;
    const known = error instanceof MucontCustomerError;
    const status = rateLimited ? 429 : known ? error.status : 503;
    const retryAfterMs = rateLimited
      ? Math.max(1, Math.ceil(Number((error.detail as { retryAfterMs?: number })?.retryAfterMs) || 1000))
      : undefined;
    const body = { error: {
      code: rateLimited ? 'RATE_LIMITED' : known ? error.code : 'SERVICE_UNAVAILABLE',
      message: rateLimited ? 'Too many customer reads. Please retry later.'
        : known ? error.message : 'Customer service is temporarily unavailable.',
      ...(known && error.customerId ? { customerId: error.customerId } : {}),
      ...(retryAfterMs ? { retryAfterMs } : {}),
    } };
    // Audit metadata only: never log credentials, search text or full customer profiles.
    logger.warn('mucont.customer.read', {
      endpoint, status, code: body.error.code, durationMs: Date.now() - startedAt,
      ...(!known && !rateLimited ? { cause: error instanceof Error ? error.name : 'UnknownError' } : {}),
    });
    return NextResponse.json(body, { status, headers: {
      'Cache-Control': 'no-store',
      ...(retryAfterMs ? { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } : {}),
    } });
  }
}
