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

let mockRole: 'ADMIN' | 'SALES' = 'ADMIN';
const mockCurrentUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'ADMIN' as const,
  level: 1,
  parentId: null,
  createdById: null,
};

jest.mock('@/lib/route-auth', () => ({
  withRole: (allowedRole: string, handler: (request: Request, currentUser: unknown) => Promise<unknown>) => (
    async (request: Request) => {
      if (mockRole !== allowedRole) {
        return { status: 403, async json() { return { success: false, error: '无权限' }; } };
      }
      return handler(request, { ...mockCurrentUser, role: mockRole });
    }
  ),
}));

let mockRequestBody: Record<string, unknown> = {};
jest.mock('@/lib/http-body', () => ({
  parseJsonRequest: jest.fn(async () => mockRequestBody),
}));

jest.mock('@/lib/email/email-notification-service', () => ({
  approveEmailNotifications: jest.fn(),
  cancelEmailNotification: jest.fn(),
  createCorrectionNotification: jest.fn(),
  listEmailDeliveryAttempts: jest.fn(),
  listEmailNotifications: jest.fn(),
  previewEmailNotification: jest.fn(),
  retryEmailNotification: jest.fn(),
}));

import { GET, POST } from '@/app/api/email-notifications/route';
import {
  approveEmailNotifications,
  listEmailDeliveryAttempts,
  listEmailNotifications,
  previewEmailNotification,
} from '@/lib/email/email-notification-service';

const mockApprove = approveEmailNotifications as jest.Mock;
const mockList = listEmailNotifications as jest.Mock;
const mockAttempts = listEmailDeliveryAttempts as jest.Mock;
const mockPreview = previewEmailNotification as jest.Mock;

function request(url = 'https://example.com/api/email-notifications') {
  return {
    url,
    nextUrl: new URL(url),
    headers: { get: () => null },
  } as never;
}

describe('email notifications route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = 'ADMIN';
    mockList.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 });
    mockAttempts.mockResolvedValue({ data: [] });
    mockPreview.mockResolvedValue({ preview: { subject: 'Preview' } });
    mockApprove.mockResolvedValue({ queuedCount: 1, message: 'queued' });
  });

  it('routes list and attempt-history reads', async () => {
    expect((await GET(request('https://example.com/api/email-notifications?page=2&pageSize=10'))).status).toBe(200);
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ id: 'admin-1' }), expect.objectContaining({
      page: '2',
      pageSize: '10',
    }));

    expect((await GET(request('https://example.com/api/email-notifications?action=attempts&notificationId=n1'))).status).toBe(200);
    expect(mockAttempts).toHaveBeenCalledWith(expect.objectContaining({ id: 'admin-1' }), { notificationId: 'n1' });
  });

  it('routes preview and batch approval actions', async () => {
    mockRequestBody = { action: 'preview', notificationId: 'n1', language: 'FRENCH' };
    expect((await POST(request())).status).toBe(200);
    expect(mockPreview).toHaveBeenCalledWith(expect.objectContaining({ id: 'admin-1' }), {
      notificationId: 'n1',
      language: 'FRENCH',
    });

    mockRequestBody = { action: 'approve', notificationIds: ['n1', 'n2'] };
    expect((await POST(request())).status).toBe(200);
    expect(mockApprove).toHaveBeenCalledWith(expect.objectContaining({ id: 'admin-1' }), {
      notificationIds: ['n1', 'n2'],
    });
  });

  it('denies SALES for all email management reads and writes', async () => {
    mockRole = 'SALES';

    expect((await GET(request())).status).toBe(403);
    expect((await POST(request())).status).toBe(403);
    expect(mockList).not.toHaveBeenCalled();
    expect(mockApprove).not.toHaveBeenCalled();
  });
});
