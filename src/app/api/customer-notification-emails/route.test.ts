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
  withAuth: (handler: (request: Request, currentUser: unknown) => Promise<unknown>) => (
    (request: Request) => handler(request, mockCurrentUser)
  ),
}));

let mockRequestBody: Record<string, unknown> = {};
jest.mock('@/lib/http-body', () => ({
  parseJsonRequest: jest.fn(async () => mockRequestBody),
}));

jest.mock('@/lib/email/customer-notification-email-service', () => ({
  addCustomerNotificationEmail: jest.fn(),
  deleteCustomerNotificationEmail: jest.fn(),
  listCustomerNotificationEmails: jest.fn(),
  setPrimaryCustomerNotificationEmail: jest.fn(),
  updateCustomerNotificationEmail: jest.fn(),
  updateCustomerNotificationLanguage: jest.fn(),
}));

import { GET, POST } from '@/app/api/customer-notification-emails/route';
import {
  addCustomerNotificationEmail,
  listCustomerNotificationEmails,
  updateCustomerNotificationLanguage,
} from '@/lib/email/customer-notification-email-service';

const mockList = listCustomerNotificationEmails as jest.Mock;
const mockAdd = addCustomerNotificationEmail as jest.Mock;
const mockUpdateLanguage = updateCustomerNotificationLanguage as jest.Mock;

describe('customer notification email route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists one visible customer notification profile', async () => {
    mockList.mockResolvedValueOnce({ data: [], language: 'ENGLISH', message: 'loaded' });

    const response = await GET({
      url: 'https://example.com/api/customer-notification-emails?customerId=customer-1',
      headers: { get: () => null },
    } as never);

    expect(response.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ id: 'admin-1' }), 'customer-1');
  });

  it('forwards add and language actions to the scoped service', async () => {
    mockAdd.mockResolvedValueOnce({ data: { id: 'email-1' }, message: 'added' });
    mockUpdateLanguage.mockResolvedValueOnce({ language: 'FRENCH', message: 'updated' });

    mockRequestBody = { action: 'add', customerId: 'customer-1', email: 'client@example.com' };
    const addResponse = await POST({
      url: 'https://example.com/api/customer-notification-emails',
      headers: { get: () => null },
    } as never);
    mockRequestBody = { action: 'update-language', customerId: 'customer-1', language: 'FRENCH' };
    const languageResponse = await POST({
      url: 'https://example.com/api/customer-notification-emails',
      headers: { get: () => null },
    } as never);

    expect(addResponse.status).toBe(200);
    expect(languageResponse.status).toBe(200);
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 'admin-1' }), 'customer-1', 'client@example.com');
    expect(mockUpdateLanguage).toHaveBeenCalledWith(expect.objectContaining({ id: 'admin-1' }), 'customer-1', 'FRENCH');
  });
});
