import { NextResponse } from 'next/server';

import {
  applyVerifiedResendWebhook,
  verifyResendWebhookPayload,
} from '@/lib/email/resend-webhook-service';
import { logger } from '@/lib/logger';
import { requireProductionSecret } from '@/lib/security-config';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const id = request.headers.get('svix-id');
  const timestamp = request.headers.get('svix-timestamp');
  const signature = request.headers.get('svix-signature');
  if (!id || !timestamp || !signature) {
    return NextResponse.json(
      { success: false, error: 'Invalid webhook signature.', code: 'BAD_REQUEST', detail: null },
      { status: 400 },
    );
  }

  const payload = await request.text();
  let verified: ReturnType<typeof verifyResendWebhookPayload>;
  try {
    const webhookSecret = requireProductionSecret(
      'RESEND_WEBHOOK_SECRET',
      process.env.RESEND_WEBHOOK_SECRET,
    );
    verified = verifyResendWebhookPayload({
      payload,
      headers: { id, timestamp, signature },
      webhookSecret,
    });
  } catch {
    logger.warn('Rejected Resend webhook', { code: 'INVALID_WEBHOOK_SIGNATURE', providerEventId: id });
    return NextResponse.json(
      { success: false, error: 'Invalid webhook signature.', code: 'BAD_REQUEST', detail: null },
      { status: 400 },
    );
  }

  try {
    const data = await applyVerifiedResendWebhook(verified);
    if (data.unknownMessage) {
      logger.warn('Resend webhook is waiting for provider message persistence', {
        code: 'EMAIL_WEBHOOK_DELIVERY_PENDING',
        providerEventId: id,
      });
      return NextResponse.json(
        {
          success: false,
          error: 'Webhook delivery is not ready yet.',
          code: 'EMAIL_WEBHOOK_DELIVERY_PENDING',
          detail: null,
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ success: true, data });
  } catch {
    logger.error('Resend webhook persistence failed', {
      code: 'EMAIL_WEBHOOK_PERSISTENCE_FAILED',
      providerEventId: id,
    });
    return NextResponse.json(
      { success: false, error: 'Webhook could not be processed.', code: 'INTERNAL_ERROR', detail: null },
      { status: 500 },
    );
  }
}
