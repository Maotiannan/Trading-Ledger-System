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

const currentUser = {
  id: 'user-1',
  email: 'user@example.com',
  name: 'User',
  role: 'USER' as const,
  level: 4,
  parentId: 'sales-1',
  createdById: 'sales-1',
};

jest.mock('@/lib/route-auth', () => ({
  withAuth: (handler: (request: Request, user: unknown) => Promise<unknown>) => (
    (request: Request) => handler(request, currentUser)
  ),
}));

jest.mock('@/lib/customer-analytics-service', () => ({
  getCustomerAnalyticsRanking: jest.fn(),
  getCustomerAnalyticsDetail: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({ logger: { error: jest.fn() } }));

import { GET } from '@/app/api/dashboard/customer-analytics/route';
import { createApiError } from '@/lib/api-error';
import {
  getCustomerAnalyticsDetail,
  getCustomerAnalyticsRanking,
} from '@/lib/customer-analytics-service';

const mockRanking = getCustomerAnalyticsRanking as jest.Mock;
const mockDetail = getCustomerAnalyticsDetail as jest.Mock;

async function call(query: string) {
  const response = await GET({
    url: `https://example.com/api/dashboard/customer-analytics?${query}`,
  } as never);
  return { response, json: await response.json() };
}

describe('dashboard customer analytics route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the selected natural-year order amount ranking', async () => {
    mockRanking.mockResolvedValue({ metric: 'annual-amount', items: [] });

    const { response, json } = await call('action=ranking&metric=annual-amount&year=2026');

    expect(response.status).toBe(200);
    expect(mockRanking).toHaveBeenCalledWith(currentUser, {
      metric: 'annual-amount',
      year: 2026,
    });
    expect(json).toEqual({ success: true, data: { metric: 'annual-amount', items: [] } });
  });

  it('defaults a missing annual year from the server Conakry clock', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-12-31T18:30:00.000Z'));
    mockRanking.mockResolvedValue({ metric: 'annual-amount', items: [] });

    const { response } = await call('action=ranking&metric=annual-amount');

    expect(response.status).toBe(200);
    expect(mockRanking).toHaveBeenCalledWith(currentUser, {
      metric: 'annual-amount',
      year: 2026,
    });
  });

  it.each(['payment-capacity', 'payment-cycle'])(
    'returns the %s ranking without a client-controlled year',
    async (metric) => {
      mockRanking.mockResolvedValue({ metric, items: [] });

      const { response } = await call(`action=ranking&metric=${metric}`);

      expect(response.status).toBe(200);
      expect(mockRanking).toHaveBeenCalledWith(currentUser, { metric });
    },
  );

  it('returns independently authorized customer detail for the active metric', async () => {
    mockDetail.mockResolvedValue({ metric: 'payment-cycle', customer: { id: 'customer-1' } });

    const { response, json } = await call('action=detail&metric=payment-cycle&customerId=customer-1');

    expect(response.status).toBe(200);
    expect(mockDetail).toHaveBeenCalledWith(currentUser, {
      metric: 'payment-cycle',
      customerId: 'customer-1',
    });
    expect(json.success).toBe(true);
  });

  it('reuses a valid ranking asOf for detail evidence', async () => {
    mockDetail.mockResolvedValue({ metric: 'payment-cycle', customer: { id: 'customer-1' } });
    const rankingAsOf = '2026-07-15T12:00:00.000Z';

    const { response } = await call(
      `action=detail&metric=payment-cycle&customerId=customer-1&asOf=${encodeURIComponent(rankingAsOf)}`,
    );

    expect(response.status).toBe(200);
    expect(mockDetail).toHaveBeenCalledWith(currentUser, {
      metric: 'payment-cycle',
      customerId: 'customer-1',
      asOf: new Date(rankingAsOf),
    });
  });

  it('passes the selected year to annual customer detail', async () => {
    mockDetail.mockResolvedValue({ metric: 'annual-amount', customer: { id: 'customer-1' } });

    const { response } = await call('action=detail&metric=annual-amount&customerId=customer-1&year=2025');

    expect(response.status).toBe(200);
    expect(mockDetail).toHaveBeenCalledWith(currentUser, {
      metric: 'annual-amount',
      customerId: 'customer-1',
      year: 2025,
    });
  });

  it.each([
    ['unknown action', 'action=unknown&metric=payment-cycle'],
    ['unknown metric', 'action=ranking&metric=credit-score'],
    ['invalid annual year', 'action=ranking&metric=annual-amount&year=2026.5'],
    ['missing detail customer', 'action=detail&metric=payment-cycle'],
    ['invalid detail asOf', 'action=detail&metric=payment-cycle&customerId=customer-1&asOf=not-a-date'],
    ['numeric detail asOf', 'action=detail&metric=payment-cycle&customerId=customer-1&asOf=1'],
    ['timezone-free detail asOf', 'action=detail&metric=payment-cycle&customerId=customer-1&asOf=2026-07-15T12%3A00%3A00.000'],
    ['normalized invalid detail date', 'action=detail&metric=payment-cycle&customerId=customer-1&asOf=2026-02-30T12%3A00%3A00.000Z'],
  ])('returns a readable bad request for %s', async (_label, query) => {
    const { response, json } = await call(query);

    expect(response.status).toBe(400);
    expect(json).toEqual(expect.objectContaining({
      success: false,
      code: 'BAD_REQUEST',
      error: expect.any(String),
    }));
    expect(mockRanking).not.toHaveBeenCalled();
    expect(mockDetail).not.toHaveBeenCalled();
  });

  it.each([
    ['FORBIDDEN', 403],
    ['RESOURCE_NOT_FOUND', 404],
  ])('preserves service %s errors', async (code, status) => {
    mockDetail.mockRejectedValue(createApiError({
      code: code as 'FORBIDDEN' | 'RESOURCE_NOT_FOUND',
      status,
      message: '客户不存在或无权限',
    }));

    const { response, json } = await call('action=detail&metric=payment-cycle&customerId=customer-1');

    expect(response.status).toBe(status);
    expect(json).toEqual(expect.objectContaining({ success: false, code }));
  });
});
