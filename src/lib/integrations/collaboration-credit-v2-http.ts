import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isApiError } from '@/lib/api-error';
import { enforceRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { CollaborationCreditError } from './collaboration-credit-http';

export async function withCreditV2(request: NextRequest, mode: 'read' | 'write', action: (secret: string, principalId: string) => Promise<unknown>) {
  const startedAt = Date.now();
  const scope = `credit-records:${mode}`;
  const headers: Record<string, string> = { 'Cache-Control': 'no-store', 'X-Collaboration-Contract': 'credit-records/2.0.0' };
  try {
    const secret = (mode === 'read' ? process.env.COLLABORATION_CREDIT_READ_TOKEN : process.env.COLLABORATION_CREDIT_WRITE_TOKEN)?.trim();
    const principalId = process.env.COLLABORATION_CREDIT_WRITE_ACTOR_ID?.trim() || '';
    if (!secret || secret.length < 32 || (mode === 'write' && (!principalId || secret === process.env.COLLABORATION_CREDIT_READ_TOKEN?.trim()))) {
      throw new CollaborationCreditError(503, 'SERVICE_UNAVAILABLE', 'Credit integration is not configured.');
    }
    const auth = request.headers.get('authorization');
    if (!auth) throw new CollaborationCreditError(401, 'AUTH_REQUIRED', 'A dedicated service bearer token is required.');
    const token = /^Bearer\s+(\S+)$/i.exec(auth)?.[1] || '';
    const hash = (v: string) => createHash('sha256').update(v).digest();
    if (!token || !timingSafeEqual(hash(token), hash(secret))) throw new CollaborationCreditError(401, 'AUTH_INVALID', 'Invalid service credential.');
    await enforceRateLimit('excelLookup', request, { identityHint: `collaboration-credit-v2-${mode}` });
    const body = await action(secret, principalId);
    logger.info('collaboration.credit.v2', { scope, status: 200, durationMs: Date.now() - startedAt });
    return NextResponse.json(body, { headers });
  } catch (error) {
    const known = error instanceof CollaborationCreditError || isApiError(error);
    const status = known ? error.status : 503;
    const code = known ? error.code : 'SERVICE_UNAVAILABLE';
    const retryAfterMs = status === 429 && isApiError(error)
      ? Math.max(1, Math.ceil(Number((error.detail as { retryAfterMs?: number })?.retryAfterMs) || 1000)) : undefined;
    if (retryAfterMs) headers['Retry-After'] = String(Math.ceil(retryAfterMs / 1000));
    logger.warn('collaboration.credit.v2', { scope, status, code, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: { code,
      message: status === 429 ? 'Too many credit integration requests. Please retry later.' : known ? error.message : 'Credit integration is temporarily unavailable.',
      ...(retryAfterMs ? { retryAfterMs } : {}),
    } }, { status, headers });
  }
}
