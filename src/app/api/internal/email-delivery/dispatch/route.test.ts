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

jest.mock('@/lib/email/email-delivery-worker', () => ({
  dispatchQueuedEmailDeliveries: jest.fn(),
}));

jest.mock('@/lib/security-config', () => ({
  requireProductionSecret: jest.fn(() => 'expected-maintenance-token'),
}));

jest.mock('@/lib/logger', () => ({ logger: { error: jest.fn() } }));

import { POST } from '@/app/api/internal/email-delivery/dispatch/route';
import { dispatchQueuedEmailDeliveries } from '@/lib/email/email-delivery-worker';

const mockDispatch = dispatchQueuedEmailDeliveries as jest.Mock;

function request(token?: string, batchSize?: string): Request {
  return {
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === 'x-maintenance-token') return token ?? null;
        if (name.toLowerCase() === 'x-email-delivery-batch-size') return batchSize ?? null;
        return null;
      },
    },
  } as unknown as Request;
}

describe('email delivery dispatch route', () => {
  const originalBatchSize = process.env.EMAIL_DELIVERY_BATCH_SIZE;
  const originalHostname = process.env.HOSTNAME;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EMAIL_DELIVERY_BATCH_SIZE = '25';
    mockDispatch.mockResolvedValue({ candidates: 1, claimed: 1, sent: 1 });
  });

  afterAll(() => {
    if (originalBatchSize === undefined) delete process.env.EMAIL_DELIVERY_BATCH_SIZE;
    else process.env.EMAIL_DELIVERY_BATCH_SIZE = originalBatchSize;
    if (originalHostname === undefined) delete process.env.HOSTNAME;
    else process.env.HOSTNAME = originalHostname;
  });

  it('rejects a missing or incorrect maintenance token without dispatching', async () => {
    await expect(POST(request())).resolves.toMatchObject({ status: 401 });
    await expect(POST(request('incorrect-token'))).resolves.toMatchObject({ status: 401 });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('dispatches the configured bounded batch with the maintenance token', async () => {
    process.env.HOSTNAME = 'app-container';

    const response = await POST(request('expected-maintenance-token', '25'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockDispatch).toHaveBeenCalledWith({ workerId: 'app-container', limit: 25 });
    expect(json).toMatchObject({ success: true, data: { sent: 1 } });
  });

  it('bounds a trigger-provided batch size before dispatching', async () => {
    await POST(request('expected-maintenance-token', '5000'));

    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
  });

  it('returns a generic error without exposing provider diagnostics', async () => {
    mockDispatch.mockRejectedValueOnce(new Error('Resend re_secret failed for customer@example.com'));

    const response = await POST(request('expected-maintenance-token'));
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(json)).not.toContain('re_secret');
    expect(JSON.stringify(json)).not.toContain('customer@example.com');
  });
});
