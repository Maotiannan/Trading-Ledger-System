import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { dispatchQueuedEmailDeliveries } from '@/lib/email/email-delivery-worker';
import { logger } from '@/lib/logger';
import { requireProductionSecret } from '@/lib/security-config';

export const runtime = 'nodejs';

function matchesSecret(candidate: string | null, expected: string): boolean {
  if (!candidate || !expected) return false;
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return candidateBuffer.length === expectedBuffer.length
    && timingSafeEqual(candidateBuffer, expectedBuffer);
}

function configuredBatchSize(request: Request): number {
  const requested = request.headers.get('x-email-delivery-batch-size');
  const parsed = Number.parseInt(requested || process.env.EMAIL_DELIVERY_BATCH_SIZE || '25', 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(100, parsed)) : 25;
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

    const data = await dispatchQueuedEmailDeliveries({
      workerId: process.env.HOSTNAME || 'muledger-email-delivery',
      limit: configuredBatchSize(request),
    });
    return NextResponse.json({ success: true, data });
  } catch {
    logger.error('Email delivery dispatch failed', { code: 'EMAIL_DELIVERY_DISPATCH_FAILED' });
    return NextResponse.json(
      { success: false, error: 'Email delivery could not be processed.', code: 'INTERNAL_ERROR', detail: null },
      { status: 500 },
    );
  }
}
