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

jest.mock('@/lib/swift-service', () => ({
  createSwiftRecord: jest.fn(),
  deleteSwiftRecord: jest.fn(),
  markSwiftReceived: jest.fn(),
  updateSwiftRecord: jest.fn(),
}));

jest.mock('@/lib/swift-edit-request-service', () => ({
  requestSwiftEdit: jest.fn(),
  reviewSwiftEdit: jest.fn(),
  listSwiftEditRequests: jest.fn(),
}));

import { POST } from '@/app/api/swift/route';
import { listSwiftEditRequests, requestSwiftEdit, reviewSwiftEdit } from '@/lib/swift-edit-request-service';
import { createSwiftRecord, markSwiftReceived, updateSwiftRecord } from '@/lib/swift-service';

const mockCreateSwiftRecord = createSwiftRecord as jest.Mock;
const mockRequestSwiftEdit = requestSwiftEdit as jest.Mock;
const mockReviewSwiftEdit = reviewSwiftEdit as jest.Mock;
const mockListSwiftEditRequests = listSwiftEditRequests as jest.Mock;
const mockUpdateSwiftRecord = updateSwiftRecord as jest.Mock;
const mockMarkSwiftReceived = markSwiftReceived as jest.Mock;

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

describe('swift route edit-approval actions', () => {
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

  it('submits request-edit through the swift edit request service', async () => {
    mockCurrentUser = {
      id: 'sales-1',
      email: 'sales@example.com',
      name: 'Sales',
      role: 'SALES',
      level: 3,
      parentId: 'admin-1',
      createdById: 'admin-1',
    };
    mockRequestSwiftEdit.mockResolvedValueOnce({
      data: { id: 'swift-req-1', status: 'PENDING' },
      message: 'SWIFT修改申请已提交，等待管理员同意',
    });

    const response = await POST(buildJsonRequest({
      action: 'request-edit',
      swiftId: 'swift-1',
      data: {
        date: '2026-05-05',
        amount: 110,
        senderName: 'New Sender',
        senderAddress: 'Conakry',
        receiverName: 'New Receiver',
        receiverAccount: '123',
      },
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockRequestSwiftEdit).toHaveBeenCalledWith({
      currentUser: expect.objectContaining({ id: 'sales-1', role: 'SALES' }),
      swiftId: 'swift-1',
      data: {
        date: '2026-05-05',
        amount: 110,
        senderName: 'New Sender',
        senderAddress: 'Conakry',
        receiverName: 'New Receiver',
        receiverAccount: '123',
      },
    });
    expect(json.success).toBe(true);
    expect(json.message).toMatch(/等待管理员同意/);
  });

  it('routes admin swift update through updateSwiftRecord', async () => {
    mockUpdateSwiftRecord.mockResolvedValueOnce({
      data: { id: 'swift-1' },
      validation: { valid: true, hasWarning: false, message: null },
    });

    const response = await POST(buildJsonRequest({
      action: 'update',
      swiftId: 'swift-1',
      data: {
        date: '2026-05-05',
        amount: 110,
        senderName: 'New Sender',
        senderAddress: 'Conakry',
        receiverName: 'New Receiver',
        receiverAccount: '123',
      },
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockUpdateSwiftRecord).toHaveBeenCalledWith({
      currentUser: expect.objectContaining({ id: 'admin-1', role: 'ADMIN' }),
      swiftId: 'swift-1',
      payload: {
        date: '2026-05-05',
        amount: 110,
        senderName: 'New Sender',
        senderAddress: 'Conakry',
        receiverName: 'New Receiver',
        receiverAccount: '123',
      },
    });
    expect(json.success).toBe(true);
  });

  it('routes admin mark-received through markSwiftReceived', async () => {
    mockMarkSwiftReceived.mockResolvedValueOnce({
      data: { id: 'swift-1', status: 'RECEIVED' },
    });

    const response = await POST(buildJsonRequest({
      action: 'mark-received',
      swiftId: 'swift-1',
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockMarkSwiftReceived).toHaveBeenCalledWith({
      currentUser: expect.objectContaining({ id: 'admin-1', role: 'ADMIN' }),
      swiftId: 'swift-1',
    });
    expect(json.success).toBe(true);
    expect(json.message).toBe('SWIFT已签收');
  });

  it('accepts nested confirm payloads used by OCR confirm flow', async () => {
    mockCreateSwiftRecord.mockResolvedValueOnce({
      swift: { id: 'swift-1' },
      validation: { valid: true, hasWarning: false, message: null },
      message: 'SWIFT已创建',
    });

    const response = await POST(buildJsonRequest({
      action: 'confirm',
      detailId: 'detail-1',
      data: {
        amount: 51386,
        date: '2026-05-01',
        senderName: 'SALAM ENTERPRISE',
        senderAddress: 'ADDRESS LINE1 MONROVIA',
        receiverName: 'MARKET UNION CO LTD',
        receiverAccount: '76881488000007249',
      },
      imagePath: '/upload/swift.jpg',
      imageName: 'swift.jpg',
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockCreateSwiftRecord).toHaveBeenCalledWith(expect.objectContaining({
      currentUser: expect.objectContaining({ id: 'admin-1', role: 'ADMIN' }),
      detailId: 'detail-1',
      payload: {
        amount: 51386,
        date: '2026-05-01',
        senderName: 'SALAM ENTERPRISE',
        senderAddress: 'ADDRESS LINE1 MONROVIA',
        receiverName: 'MARKET UNION CO LTD',
        receiverAccount: '76881488000007249',
      },
      imagePath: '/upload/swift.jpg',
      imageName: 'swift.jpg',
      mode: 'confirm',
    }));
    expect(json.success).toBe(true);
  });

  it('submits review-edit through the swift edit review service', async () => {
    mockReviewSwiftEdit.mockResolvedValueOnce({ message: 'SWIFT修改申请已通过' });

    const response = await POST(buildJsonRequest({
      action: 'review-edit',
      requestId: 'swift-req-1',
      decision: 'approve',
      comment: 'ok',
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockReviewSwiftEdit).toHaveBeenCalledWith({
      currentUser: expect.objectContaining({ id: 'admin-1', role: 'ADMIN' }),
      requestId: 'swift-req-1',
      decision: 'approve',
      comment: 'ok',
    });
    expect(json.message).toMatch(/已通过/);
  });

  it('lists swift edit requests through list-edit-requests action', async () => {
    mockListSwiftEditRequests.mockResolvedValueOnce([{ id: 'swift-req-1' }]);

    const response = await POST(buildJsonRequest({ action: 'list-edit-requests' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockListSwiftEditRequests).toHaveBeenCalledWith(expect.objectContaining({
      id: 'admin-1',
      role: 'ADMIN',
    }));
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
  });
});
