jest.mock('next/server', () => {
  const NextResponse: any = class MockNextResponse {
    status: number;
    headers: Headers;
    body: unknown;

    constructor(body?: unknown, init?: ResponseInit) {
      this.status = init?.status ?? 200;
      this.headers = new Headers(init?.headers);
      this.body = body;
    }

    static json(body: unknown, init?: ResponseInit) {
      return {
        status: init?.status ?? 200,
        async json() {
          return body;
        },
      };
    }
  };

  return { NextResponse };
});

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

jest.mock('@/lib/db', () => ({
  db: {
    detail: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('@/lib/user-hierarchy', () => ({
  getHierarchyScope: jest.fn(),
}));

jest.mock('@/lib/detail-export-image', () => ({
  renderDetailExportPng: jest.fn(),
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

import { db } from '@/lib/db';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { renderDetailExportPng } from '@/lib/detail-export-image';
import { GET, POST } from '@/app/api/detail/route';
import { listDetailEditRequests, requestDetailEdit, reviewDetailEdit } from '@/lib/detail-edit-request-service';
import { createDetailRecord, updateDetailRecord } from '@/lib/detail-service';

const mockDb = db as unknown as {
  detail: {
    findFirst: jest.Mock;
  };
};
const mockGetHierarchyScope = getHierarchyScope as jest.Mock;
const mockRenderDetailExportPng = renderDetailExportPng as jest.Mock;
const mockCreateDetailRecord = createDetailRecord as jest.Mock;
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

function buildGetRequest(url: string) {
  return { url } as never;
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
    mockGetHierarchyScope.mockResolvedValue({
      ownerVisibleIds: new Set(['admin-1', 'sales-1']),
    });
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

  it('accepts nested confirm payloads used by OCR confirm flow', async () => {
    mockCreateDetailRecord.mockResolvedValueOnce({
      data: { id: 'detail-1' },
      message: '付款明细已创建',
    });

    const response = await POST(buildJsonRequest({
      action: 'confirm',
      data: {
        date: '2026-05-05',
        items: [{ mark: 'MAB-2', orderNo: 'MAB-2-11', amount: 120, matchedReceiptId: 'receipt-2' }],
      },
      imagePath: '/upload/test.png',
      imageName: 'test.png',
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockCreateDetailRecord).toHaveBeenCalledWith(expect.objectContaining({
      currentUser: expect.objectContaining({ id: 'admin-1', role: 'ADMIN' }),
      payload: {
        date: '2026-05-05',
        items: [{ mark: 'MAB-2', orderNo: 'MAB-2-11', amount: 120, matchedReceiptId: 'receipt-2', receiptId: null }],
      },
      imagePath: '/upload/test.png',
      imageName: 'test.png',
      mode: 'confirm',
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

  it('exports direct-created payment detail pictures through the export-pic action', async () => {
    mockDb.detail.findFirst.mockResolvedValueOnce({
      id: 'detail-1',
      sourceMode: 'DIRECT',
      date: '2026-05-05T00:00:00.000Z',
      items: [{ id: 'item-1', mark: 'MAB', orderNo: 'MAB-1-01', amount: 120 }],
      creator: { id: 'admin-1', name: 'Admin', email: 'admin@example.com' },
    });
    const png = Buffer.from([137, 80, 78, 71]);
    mockRenderDetailExportPng.mockResolvedValueOnce(png);

    const response = await GET(buildGetRequest('https://example.com/api/detail?action=export-pic&detailId=detail-1'));

    expect(response.status).toBe(200);
    expect(mockDb.detail.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'detail-1' }),
    }));
    expect(mockRenderDetailExportPng).toHaveBeenCalledWith(expect.objectContaining({ id: 'detail-1' }));
    expect(response.headers.get('content-type')).toBe('image/png');
  });
});
