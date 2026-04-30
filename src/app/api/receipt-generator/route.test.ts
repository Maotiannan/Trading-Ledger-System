import { apiErrorCodes } from '@/lib/api-error';
import { POST } from '@/app/api/receipt-generator/route';
import { finalizeReceiptGeneratorSession } from '@/lib/receipt-generator-service';

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

jest.mock('@/lib/route-auth', () => ({
  withAuth: (handler: (request: unknown, currentUser: unknown) => Promise<unknown>) => {
    const currentUser = {
      id: 'admin-1',
      email: 'admin@example.com',
      name: 'Admin',
      role: 'ADMIN',
      level: 1,
      parentId: null,
      createdById: null,
    };
    return (request: Request) => handler(request, currentUser);
  },
}));

jest.mock('@/lib/receipt-generator-service', () => ({
  createReceiptGeneratorSession: jest.fn(),
  finalizeReceiptGeneratorSession: jest.fn(),
}));

jest.mock('@/lib/receipt-generator-read-service', () => ({
  getOpenReceiptGeneratorSessionByReceipt: jest.fn(),
  getReceiptGeneratorSession: jest.fn(),
  lookupReceiptGeneratorOrderContext: jest.fn(),
}));

const mockFinalizeReceiptGeneratorSession = finalizeReceiptGeneratorSession as jest.Mock;

describe('receipt-generator route', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeAll(() => {
    class MockFile {
      name: string;
      type: string;

      constructor(_parts: unknown[], name: string, options?: { type?: string }) {
        this.name = name;
        this.type = options?.type || '';
      }
    }

    Object.defineProperty(globalThis, 'File', {
      value: MockFile,
      configurable: true,
      writable: true,
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('maps aborted multipart finalize uploads to UPLOAD_ABORTED', async () => {
    mockFinalizeReceiptGeneratorSession.mockRejectedValueOnce(new Error('aborted'));

    const receiptImage = new File(['receipt'], 'receipt.png', { type: 'image/png' });
    const receiverSignature = new File(['receiver'], 'receiver.png', { type: 'image/png' });
    const payerSignature = new File(['payer'], 'payer.png', { type: 'image/png' });
    const formData = {
      get(key: string) {
        const values: Record<string, unknown> = {
          action: 'finalize',
          sessionId: 'session-1',
          receiptImage,
          receiverSignature,
          payerSignature,
        };
        return values[key] ?? null;
      },
    };
    const request = {
      url: 'http://localhost/api/receipt-generator',
      headers: {
        get(name: string) {
          return name === 'content-type' ? 'multipart/form-data; boundary=test' : null;
        },
      },
      async formData() {
        return formData;
      },
    };

    const response = await POST(request as never);
    const json = await response.json();

    expect(response.status).toBe(499);
    expect(json.code).toBe(apiErrorCodes.UPLOAD_ABORTED);
    expect(json.error).toContain('上传中断');
  });
});
