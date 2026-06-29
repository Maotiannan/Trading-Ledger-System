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
      findMany: jest.fn(),
    },
    receipt: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('@/lib/user-hierarchy', () => ({
  getHierarchyScope: jest.fn(),
}));

jest.mock('@/lib/detail-export-image', () => ({
  buildDetailExportViewModel: jest.fn(),
  renderDetailExportJpeg: jest.fn(),
}));

jest.mock('@/lib/detail-image-assets', () => ({
  ensureDetailPreviewImage: jest.fn(),
  regenerateDetailPreviewImage: jest.fn(),
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

jest.mock('@/lib/matching', () => ({
  findMatchingReceipt: jest.fn(),
}));

jest.mock('@/lib/invoice-read-service', () => ({
  lookupInvoiceOrderContext: jest.fn(),
}));

import { db } from '@/lib/db';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { buildDetailExportViewModel, renderDetailExportJpeg } from '@/lib/detail-export-image';
import { ensureDetailPreviewImage, regenerateDetailPreviewImage } from '@/lib/detail-image-assets';
import { GET, POST } from '@/app/api/detail/route';
import { listDetailEditRequests, requestDetailEdit, reviewDetailEdit } from '@/lib/detail-edit-request-service';
import { createDetailRecord, updateDetailRecord } from '@/lib/detail-service';
import { findMatchingReceipt } from '@/lib/matching';
import { lookupInvoiceOrderContext } from '@/lib/invoice-read-service';

const mockDb = db as unknown as {
  detail: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
  };
  receipt: {
    findUnique: jest.Mock;
  };
};
const mockGetHierarchyScope = getHierarchyScope as jest.Mock;
const mockBuildDetailExportViewModel = buildDetailExportViewModel as jest.Mock;
const mockRenderDetailExportJpeg = renderDetailExportJpeg as jest.Mock;
const mockEnsureDetailPreviewImage = ensureDetailPreviewImage as jest.Mock;
const mockRegenerateDetailPreviewImage = regenerateDetailPreviewImage as jest.Mock;
const mockCreateDetailRecord = createDetailRecord as jest.Mock;
const mockRequestDetailEdit = requestDetailEdit as jest.Mock;
const mockReviewDetailEdit = reviewDetailEdit as jest.Mock;
const mockListDetailEditRequests = listDetailEditRequests as jest.Mock;
const mockUpdateDetailRecord = updateDetailRecord as jest.Mock;
const mockFindMatchingReceipt = findMatchingReceipt as jest.Mock;
const mockLookupInvoiceOrderContext = lookupInvoiceOrderContext as jest.Mock;

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
    mockLookupInvoiceOrderContext.mockResolvedValue({
      data: {
        exactMatches: [],
        inferredCustomer: null,
      },
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
        agentId: 'agent-2',
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
        agentId: 'agent-2',
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
        agentId: null,
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
        agentId: null,
        date: '2026-05-05',
        items: [{ mark: 'MAB-2', orderNo: 'MAB-2-11', amount: 120, matchedReceiptId: 'receipt-2', receiptId: null }],
      },
      imagePath: '/upload/test.png',
      imageName: 'test.png',
      mode: 'confirm',
    }));
    expect(json.success).toBe(true);
  });

  it('passes selected receipt ids through direct-create payloads', async () => {
    mockCreateDetailRecord.mockResolvedValueOnce({
      data: { id: 'detail-direct-1' },
      message: '付款明细已直接创建',
    });

    const response = await POST(buildJsonRequest({
      action: 'direct-create',
      date: '2026-05-23',
      items: [
        { mark: 'PIKIN', orderNo: 'PIKIN-20', amount: 250, receiptId: 'receipt-selected-1' },
        { mark: 'MAB', orderNo: 'MAB-1-01', amount: 120 },
      ],
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockCreateDetailRecord).toHaveBeenCalledWith(expect.objectContaining({
      currentUser: expect.objectContaining({ id: 'admin-1', role: 'ADMIN' }),
      payload: {
        agentId: null,
        date: '2026-05-23',
        items: [
          { mark: 'PIKIN', orderNo: 'PIKIN-20', amount: 250, receiptId: 'receipt-selected-1', matchedReceiptId: null },
          { mark: 'MAB', orderNo: 'MAB-1-01', amount: 120, receiptId: null, matchedReceiptId: null },
        ],
      },
      imagePath: null,
      imageName: null,
      mode: 'direct-create',
    }));
    expect(json.success).toBe(true);
    expect(json.message).toBe('付款明细已直接创建');
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

  it('returns waiting detail options for swift creation', async () => {
    mockDb.detail.findMany.mockResolvedValueOnce([
      { id: 'detail-1', date: '2026-05-05T00:00:00.000Z', totalAmount: 101326 },
    ]);

    const response = await GET(buildGetRequest('https://example.com/api/detail?action=waiting-options'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockDb.detail.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'Waiting_SWIFT' }),
    }));
    expect(json.success).toBe(true);
    expect(json.data).toEqual([
      { id: 'detail-1', date: '2026-05-05T00:00:00.000Z', totalAmount: 101326 },
    ]);
  });

  it('filters detail list by repeated status parameters', async () => {
    mockDb.detail.findMany.mockResolvedValueOnce([]);

    const response = await GET(buildGetRequest('https://example.com/api/detail?status=Waiting_SWIFT&status=ERROR'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockDb.detail.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          { status: { in: ['Waiting_SWIFT', 'ERROR'] } },
        ]),
      }),
    }));
    expect(json.success).toBe(true);
  });

  it('previews detail edit order matches against existing workflow receipts', async () => {
    mockFindMatchingReceipt.mockResolvedValueOnce('receipt-bank');
    mockDb.receipt.findUnique.mockResolvedValueOnce({
      id: 'receipt-bank',
      orderNo: 'IBS-01',
    });
    mockLookupInvoiceOrderContext.mockResolvedValueOnce({
      data: {
        exactMatches: [{ customerMark: 'IBS' }],
        inferredCustomer: null,
      },
    });

    const response = await GET(buildGetRequest('https://example.com/api/detail?action=order-preview&orderNo=IBS-01&amount=2000'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockFindMatchingReceipt).toHaveBeenCalledWith('IBS-01', 2000, expect.objectContaining({
      statuses: ['SR_Received', 'Waiting_SWIFT', 'Bank_Transfer'],
      requireAmountTolerance: false,
    }));
    expect(json.data).toEqual(expect.objectContaining({
      matchedReceiptId: 'receipt-bank',
      linkedReceiptLabel: 'IBS-01',
      suggestedMark: 'IBS',
      willCreateReceipt: false,
    }));
  });

  it('regenerates and persists the preview image when exporting payment detail pictures', async () => {
    mockDb.detail.findFirst.mockResolvedValueOnce({
      id: 'detail-1',
    });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff]);
    mockRegenerateDetailPreviewImage.mockResolvedValueOnce({
      path: '/upload/images/details/ocr/payment-detail_120_2026-05-05_Mitty_Group.jpg',
      name: 'payment-detail_120_2026-05-05_Mitty_Group.jpg',
      mimeType: 'image/jpeg',
      buffer: jpeg,
    });

    const response = await GET(buildGetRequest('https://example.com/api/detail?action=export-pic&detailId=detail-1'));

    expect(response.status).toBe(200);
    expect(mockDb.detail.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'detail-1' }),
    }));
    expect(mockRegenerateDetailPreviewImage).toHaveBeenCalledWith('detail-1', { includeBuffer: true });
    expect(mockBuildDetailExportViewModel).not.toHaveBeenCalled();
    expect(mockRenderDetailExportJpeg).not.toHaveBeenCalled();
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('content-disposition')).toContain('payment-detail_120_2026-05-05_Mitty_Group.jpg');
  });

  it('serves and persists a generated preview image for details without uploaded images', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff]);
    mockDb.detail.findFirst.mockResolvedValueOnce({ id: 'detail-1' });
    mockEnsureDetailPreviewImage.mockResolvedValueOnce({
      path: '/upload/images/details/ocr/payment-detail_250_2026-05-23_Mitty_Group.jpg',
      name: 'payment-detail_250_2026-05-23_Mitty_Group.jpg',
      buffer: jpeg,
      mimeType: 'image/jpeg',
    });

    const response = await GET(buildGetRequest('https://example.com/api/detail?action=preview-image&detailId=detail-1'));

    expect(response.status).toBe(200);
    expect(mockEnsureDetailPreviewImage).toHaveBeenCalledWith('detail-1', { includeBuffer: true });
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('content-disposition')).toContain('inline');
  });
});
