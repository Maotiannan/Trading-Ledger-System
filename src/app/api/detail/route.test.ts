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

jest.mock('@/lib/detail-service', () => ({
  createDetailRecord: jest.fn(),
  updateDetailRecord: jest.fn(),
}));

jest.mock('@/lib/detail-edit-request-service', () => ({
  requestDetailEdit: jest.fn(),
  reviewDetailEdit: jest.fn(),
  listDetailEditRequests: jest.fn(),
}));

import { POST } from '@/app/api/detail/route';
import { listDetailEditRequests, requestDetailEdit, reviewDetailEdit } from '@/lib/detail-edit-request-service';
import { updateDetailRecord } from '@/lib/detail-service';

const mockRequestDetailEdit = requestDetailEdit as jest.Mock;
const mockReviewDetailEdit = reviewDetailEdit as jest.Mock;
const mockListDetailEditRequests = listDetailEditRequests as jest.Mock;
const mockUpdateDetailRecord = updateDetailRecord as jest.Mock;

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

describe('detail route edit-approval actions', () => {
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

  it('submits request-edit through the detail edit request service', async () => {
    mockCurrentUser = {
      id: 'sales-1',
      email: 'sales@example.com',
      name: 'Sales',
      role: 'SALES',
      level: 3,
      parentId: 'admin-1',
      createdById: 'admin-1',
    };
    mockRequestDetailEdit.mockResolvedValueOnce({
      data: { id: 'detail-req-1', status: 'PENDING' },
      message: '付款明细修改申请已提交，等待管理员同意',
    });

    const response = await POST(buildJsonRequest({
      action: 'request-edit',
      detailId: 'detail-1',
      data: {
        date: '2026-05-05',
        items: [{ mark: 'MAB-2', orderNo: 'MAB-2-11', amount: 120, receiptId: 'receipt-2' }],
      },
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockRequestDetailEdit).toHaveBeenCalledWith(expect.objectContaining({
      currentUser: expect.objectContaining({ id: 'sales-1', role: 'SALES' }),
      detailId: 'detail-1',
      data: {
        date: '2026-05-05',
        items: [{ mark: 'MAB-2', orderNo: 'MAB-2-11', amount: 120, receiptId: 'receipt-2' }],
      },
    }));
    expect(json.success).toBe(true);
    expect(json.message).toMatch(/等待管理员同意/);
  });

  it('routes admin detail update through updateDetailRecord', async () => {
    mockUpdateDetailRecord.mockResolvedValueOnce({
      data: { id: 'detail-1' },
    });

    const response = await POST(buildJsonRequest({
      action: 'update',
      detailId: 'detail-1',
      data: {
        date: '2026-05-05',
        items: [{ mark: 'MAB-2', orderNo: 'MAB-2-11', amount: 120, receiptId: 'receipt-2' }],
      },
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockUpdateDetailRecord).toHaveBeenCalledWith(expect.objectContaining({
      currentUser: expect.objectContaining({ id: 'admin-1', role: 'ADMIN' }),
      detailId: 'detail-1',
      payload: {
        date: '2026-05-05',
        items: [{ mark: 'MAB-2', orderNo: 'MAB-2-11', amount: 120, receiptId: 'receipt-2', matchedReceiptId: null }],
      },
      imagePath: null,
      imageName: null,
    }));
    expect(json.success).toBe(true);
  });

  it('submits review-edit through the detail edit review service', async () => {
    mockReviewDetailEdit.mockResolvedValueOnce({ message: '付款明细修改申请已通过' });

    const response = await POST(buildJsonRequest({
      action: 'review-edit',
      requestId: 'detail-req-1',
      decision: 'approve',
      comment: 'ok',
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockReviewDetailEdit).toHaveBeenCalledWith({
      currentUser: expect.objectContaining({ id: 'admin-1', role: 'ADMIN' }),
      requestId: 'detail-req-1',
      decision: 'approve',
      comment: 'ok',
    });
    expect(json.message).toMatch(/已通过/);
  });

  it('lists detail edit requests through list-edit-requests action', async () => {
    mockListDetailEditRequests.mockResolvedValueOnce([{ id: 'detail-req-1' }]);

    const response = await POST(buildJsonRequest({ action: 'list-edit-requests' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockListDetailEditRequests).toHaveBeenCalledWith(expect.objectContaining({
      id: 'admin-1',
      role: 'ADMIN',
    }));
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
  });
});
