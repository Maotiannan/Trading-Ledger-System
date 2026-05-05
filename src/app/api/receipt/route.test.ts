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

type MockCurrentUser = {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'SALES' | 'USER';
  level: number;
  parentId: string | null;
  createdById: string | null;
};

let mockCurrentUser: MockCurrentUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'ADMIN',
  level: 1,
  parentId: null,
  createdById: null,
};

jest.mock('@/lib/route-auth', () => ({
  withAuth: (handler: (request: Request, currentUser: unknown) => Promise<unknown>) => {
    return (request: Request) => handler(request, mockCurrentUser);
  },
}));

jest.mock('@/lib/receipt-service', () => ({
  createReceiptRecord: jest.fn(),
  markReceiptReceived: jest.fn(),
  updateReceiptRecord: jest.fn(),
}));

jest.mock('@/lib/receipt-edit-request-service', () => ({
  requestReceiptEdit: jest.fn(),
  reviewReceiptEdit: jest.fn(),
  listReceiptEditRequests: jest.fn(),
}));

import { POST } from '@/app/api/receipt/route';
import { listReceiptEditRequests, requestReceiptEdit, reviewReceiptEdit } from '@/lib/receipt-edit-request-service';

const mockRequestReceiptEdit = requestReceiptEdit as jest.Mock;
const mockReviewReceiptEdit = reviewReceiptEdit as jest.Mock;
const mockListReceiptEditRequests = listReceiptEditRequests as jest.Mock;

function buildJsonRequest(payload: Record<string, unknown>) {
  return {
    headers: {
      get(name: string) {
        return name.toLowerCase() === 'content-type' ? 'application/json' : null;
      },
    },
    async text() {
      return JSON.stringify(payload);
    },
  } as never;
}

describe('receipt route edit-approval actions', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockCurrentUser = {
      id: 'admin-1',
      email: 'admin@example.com',
      name: 'Admin',
      role: 'ADMIN',
      level: 1,
      parentId: null,
      createdById: null,
    };
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('submits request-edit through the receipt edit request service', async () => {
    mockCurrentUser = {
      id: 'sales-1',
      email: 'sales@example.com',
      name: 'Sales',
      role: 'SALES',
      level: 3,
      parentId: 'admin-1',
      createdById: 'admin-1',
    };
    mockRequestReceiptEdit.mockResolvedValueOnce({
      data: { id: 'req-1', status: 'PENDING' },
      message: '收据修改申请已提交，等待管理员同意',
    });

    const response = await POST(buildJsonRequest({
      action: 'request-edit',
      receiptId: 'receipt-1',
      data: {
        receiptNo: '0001002',
        date: '2026-05-04',
        invNo: 'INV-2',
        customerMark: 'MAB-2',
        payer: 'BETA',
        tel: '456',
      },
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockRequestReceiptEdit).toHaveBeenCalledWith({
      currentUser: expect.objectContaining({ id: 'sales-1', role: 'SALES' }),
      receiptId: 'receipt-1',
      data: {
        receiptNo: '0001002',
        date: '2026-05-04',
        invNo: 'INV-2',
        customerMark: 'MAB-2',
        payer: 'BETA',
        tel: '456',
      },
    });
    expect(json.success).toBe(true);
    expect(json.message).toBe('收据修改申请已提交，等待管理员同意');
  });

  it('submits review-edit through the receipt edit review service', async () => {
    mockReviewReceiptEdit.mockResolvedValueOnce({
      message: '收据修改申请已通过',
    });

    const response = await POST(buildJsonRequest({
      action: 'review-edit',
      requestId: 'req-1',
      decision: 'approve',
      comment: 'ok',
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockReviewReceiptEdit).toHaveBeenCalledWith({
      currentUser: expect.objectContaining({ id: 'admin-1', role: 'ADMIN' }),
      requestId: 'req-1',
      decision: 'approve',
      comment: 'ok',
    });
    expect(json.success).toBe(true);
    expect(json.message).toBe('收据修改申请已通过');
  });

  it('lists edit requests through list-edit-requests action', async () => {
    mockListReceiptEditRequests.mockResolvedValueOnce([
      {
        id: 'req-1',
        receiptId: 'receipt-1',
        status: 'PENDING',
        requestedBy: 'sales-1',
        requestedByName: 'Sales',
        approvedBy: null,
        approvedByName: null,
        requestedAt: '2026-05-04T00:00:00.000Z',
        reviewedAt: null,
        beforeSnapshot: {
          receiptNo: '0001001',
          date: null,
          invNo: 'INV-1',
          customerMark: 'MAB-1',
          payer: 'ALPHA',
          tel: '123',
        },
        afterSnapshot: {
          receiptNo: '0001002',
          date: '2026-05-04',
          invNo: 'INV-2',
          customerMark: 'MAB-2',
          payer: 'BETA',
          tel: '456',
        },
        reviewComment: null,
      },
    ]);

    const response = await POST(buildJsonRequest({
      action: 'list-edit-requests',
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockListReceiptEditRequests).toHaveBeenCalledWith(expect.objectContaining({
      id: 'admin-1',
      role: 'ADMIN',
    }));
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
  });

  it('rejects malformed request-edit payloads before calling the service', async () => {
    mockCurrentUser = {
      id: 'sales-1',
      email: 'sales@example.com',
      name: 'Sales',
      role: 'SALES',
      level: 3,
      parentId: 'admin-1',
      createdById: 'admin-1',
    };

    const response = await POST(buildJsonRequest({
      action: 'request-edit',
      receiptId: 'receipt-1',
      data: {
        receiptNo: '0001002',
        date: 20260504,
        invNo: 'INV-2',
        customerMark: 'MAB-2',
        payer: 'BETA',
        tel: '456',
      },
    }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(mockRequestReceiptEdit).not.toHaveBeenCalled();
    expect(json.success).toBe(false);
  });
});
