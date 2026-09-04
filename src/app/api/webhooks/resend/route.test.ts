jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => ({
      status: init?.status ?? 200,
      async json() {
        return body;
      },
    }),
  },
}));

jest.mock('@/lib/email/resend-webhook-service', () => ({
  verifyResendWebhookPayload: jest.fn(),
  applyVerifiedResendWebhook: jest.fn(),
}));

jest.mock('@/lib/security-config', () => ({
  requireProductionSecret: jest.fn(() => 'whsec_expected'),
}));

jest.mock('@/lib/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn() } }));

import { POST } from '@/app/api/webhooks/resend/route';
import {
  applyVerifiedResendWebhook,
  verifyResendWebhookPayload,
} from '@/lib/email/resend-webhook-service';

const mockVerify = verifyResendWebhookPayload as jest.Mock;
const mockApply = applyVerifiedResendWebhook as jest.Mock;

function request(input: {
  body?: string;
  id?: string;
  timestamp?: string;
  signature?: string;
} = {}): Request {
  const headers = new Map<string, string>([
    ['svix-id', input.id ?? 'svix-1'],
    ['svix-timestamp', input.timestamp ?? '123'],
    ['svix-signature', input.signature ?? 'v1,signature'],
  ]);
  return {
    text: jest.fn().mockResolvedValue(input.body ?? '{"type":"email.sent"}'),
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
  } as unknown as Request;
}

describe('Resend webhook route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerify.mockReturnValue({
      providerEventId: 'svix-1',
      type: 'email.sent',
      data: { email_id: 'resend-1' },
      occurredAt: new Date('2026-09-01T02:00:00.000Z'),
    });
    mockApply.mockResolvedValue({ duplicate: false, applied: true, unknownMessage: false });
  });

  it('verifies the untouched raw body and all signature headers before applying', async () => {
    const rawBody = '{\n  "type": "email.sent"\n}';
    const response = await POST(request({ body: rawBody }));

    expect(response.status).toBe(200);
    expect(mockVerify).toHaveBeenCalledWith({
      payload: rawBody,
      headers: { id: 'svix-1', timestamp: '123', signature: 'v1,signature' },
      webhookSecret: 'whsec_expected',
    });
    expect(mockApply).toHaveBeenCalledWith(expect.objectContaining({ providerEventId: 'svix-1' }));
  });

  it('rejects missing signature headers before verification', async () => {
    const invalid = request();
    invalid.headers.get = () => null;

    const response = await POST(invalid);

    expect(response.status).toBe(400);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature without applying or exposing secret diagnostics', async () => {
    mockVerify.mockImplementationOnce(() => {
      throw new Error('Invalid signature using whsec_expected');
    });

    const response = await POST(request());
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(mockApply).not.toHaveBeenCalled();
    expect(JSON.stringify(json)).not.toContain('whsec_expected');
  });

  it('acknowledges a duplicate event with 200 so Resend does not retry it', async () => {
    mockApply.mockResolvedValueOnce({ duplicate: true, applied: false });

    const response = await POST(request());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ success: true, data: { duplicate: true } });
  });

  it('asks Resend to retry when the provider message has not been persisted yet', async () => {
    mockApply.mockResolvedValueOnce({ duplicate: false, applied: false, unknownMessage: true });

    const response = await POST(request());
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json).toMatchObject({
      success: false,
      code: 'EMAIL_WEBHOOK_DELIVERY_PENDING',
    });
  });

  it('returns a generic server failure for storage errors', async () => {
    mockApply.mockRejectedValueOnce(new Error('DATABASE_URL mysql://secret'));

    const response = await POST(request());
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(json)).not.toContain('mysql://secret');
  });
});
