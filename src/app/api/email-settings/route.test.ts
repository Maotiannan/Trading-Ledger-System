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

jest.mock('@/lib/email/email-settings', () => ({
  ensureDefaultEmailTemplates: jest.fn(),
  getEmailSettings: jest.fn(),
  listActiveEmailTemplates: jest.fn(),
  previewEmailTemplate: jest.fn(),
  saveEmailTemplate: jest.fn(),
  updateEmailSettings: jest.fn(),
}));

import { GET, POST } from '@/app/api/email-settings/route';
import {
  getEmailSettings,
  listActiveEmailTemplates,
  previewEmailTemplate,
  saveEmailTemplate,
  updateEmailSettings,
} from '@/lib/email/email-settings';

const mockGetSettings = getEmailSettings as jest.Mock;
const mockListTemplates = listActiveEmailTemplates as jest.Mock;
const mockPreview = previewEmailTemplate as jest.Mock;
const mockSaveTemplate = saveEmailTemplate as jest.Mock;
const mockUpdateSettings = updateEmailSettings as jest.Mock;
const originalResendApiKey = process.env.RESEND_API_KEY;
const originalResendWebhookSecret = process.env.RESEND_WEBHOOK_SECRET;

function request() {
  return {
    url: 'https://example.com/api/email-settings',
    headers: { get: () => null },
  } as never;
}

describe('email settings route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = 'ADMIN';
    mockGetSettings.mockResolvedValue({ outboundEnabled: false, testModeEnabled: true });
    mockListTemplates.mockResolvedValue([]);
  });

  afterEach(() => {
    if (originalResendApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalResendApiKey;
    if (originalResendWebhookSecret === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
    else process.env.RESEND_WEBHOOK_SECRET = originalResendWebhookSecret;
  });

  it('returns settings, templates, variables, and secret-presence flags without secrets', async () => {
    process.env.RESEND_API_KEY = 'secret-value';
    delete process.env.RESEND_WEBHOOK_SECRET;

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.apiKeyConfigured).toBe(true);
    expect(body.webhookSecretConfigured).toBe(false);
    expect(body.variableCatalog.PAYMENT_RECEIVED).toContain('receiptNo');
    expect(JSON.stringify(body)).not.toContain('secret-value');
  });

  it('routes settings, template, and preview actions to the email service', async () => {
    mockUpdateSettings.mockResolvedValue({ settings: { outboundEnabled: false }, message: 'saved' });
    mockSaveTemplate.mockResolvedValue({ template: { id: 'template-2' }, message: 'saved' });
    mockPreview.mockResolvedValue({ preview: { subject: 'Preview' }, message: 'previewed' });

    mockRequestBody = { action: 'save-settings', settings: { outboundEnabled: false } };
    expect((await POST(request())).status).toBe(200);
    mockRequestBody = { action: 'save-template', template: { type: 'SHIPMENT', language: 'ENGLISH' } };
    expect((await POST(request())).status).toBe(200);
    mockRequestBody = { action: 'preview-template', template: { type: 'RELEASE', language: 'FRENCH' } };
    expect((await POST(request())).status).toBe(200);

    expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({ id: 'admin-1' }), { outboundEnabled: false });
    expect(mockSaveTemplate).toHaveBeenCalledWith(expect.objectContaining({ id: 'admin-1' }), expect.objectContaining({ type: 'SHIPMENT' }));
    expect(mockPreview).toHaveBeenCalledWith(expect.objectContaining({ id: 'admin-1' }), expect.objectContaining({ type: 'RELEASE' }));
  });

  it('denies SALES for reads and writes', async () => {
    mockRole = 'SALES';

    expect((await GET(request())).status).toBe(403);
    expect((await POST(request())).status).toBe(403);
    expect(mockGetSettings).not.toHaveBeenCalled();
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });
});
