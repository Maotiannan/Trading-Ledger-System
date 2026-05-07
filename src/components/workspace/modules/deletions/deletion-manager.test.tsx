import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DeletionManager } from './deletion-manager';
import { apiCall, useUiText } from '@/components/workspace/shared';
import { useStore } from '@/lib/store';

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
  useUiText: jest.fn(),
}));

jest.mock('@/lib/store', () => ({
  useStore: jest.fn(),
}));

const mockApiCall = apiCall as jest.Mock;
const mockUseUiText = useUiText as jest.Mock;
const mockUseStore = useStore as unknown as jest.Mock;

const deletionRequests = Array.from({ length: 25 }, (_, index) => ({
  id: `del-${index + 1}`,
  targetType: 'RECEIPT' as const,
  targetId: `receipt-${index + 1}`,
  reason: `reason-${index + 1}`,
  status: 'PENDING' as const,
  requestedBy: 'sales-1',
  approvedBy: null,
  createdAt: '2026-05-07T00:00:00.000Z',
  requester: { id: 'sales-1', name: `Sales ${index + 1}`, email: 'sales@example.com' },
  approver: null,
}));

function buildReceiptEditRequests(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `receipt-edit-${index + 1}`,
    status: 'PENDING',
    requestedByName: `Sales ${index + 1}`,
    approvedByName: null,
    requestedAt: '2026-05-07T00:00:00.000Z',
    beforeSnapshot: {
      receiptNo: `R-${index + 1}`,
      date: '2026-05-07',
      orderNo: `ORD-${index + 1}`,
      invNo: null,
      customerMark: 'MAB',
      payer: 'Payer',
      tel: '620000000',
    },
    afterSnapshot: {
      receiptNo: `R-${index + 1}`,
      date: '2026-05-07',
      orderNo: `ORD-${index + 1}`,
      invNo: null,
      customerMark: 'MAB',
      payer: 'Payer',
      tel: '620000000',
    },
  }));
}

function buildDetailEditRequests(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `detail-edit-${index + 1}`,
    status: 'PENDING',
    requestedByName: `Sales ${index + 1}`,
    approvedByName: null,
    requestedAt: '2026-05-07T00:00:00.000Z',
    beforeSnapshot: {
      date: '2026-05-07',
      items: [{ mark: 'MAB', orderNo: `ORD-${index + 1}`, amount: 100, receiptId: null }],
    },
    afterSnapshot: {
      date: '2026-05-07',
      items: [{ mark: 'MAB', orderNo: `ORD-${index + 1}`, amount: 100, receiptId: null }],
    },
  }));
}

function buildSwiftEditRequests(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `swift-edit-${index + 1}`,
    status: 'PENDING',
    requestedByName: `Sales ${index + 1}`,
    approvedByName: null,
    requestedAt: '2026-05-07T00:00:00.000Z',
    beforeSnapshot: {
      date: '2026-05-07',
      amount: 100,
      senderName: 'Sender',
      senderAddress: null,
      receiverName: 'Receiver',
      receiverAccount: '123',
    },
    afterSnapshot: {
      date: '2026-05-07',
      amount: 100,
      senderName: 'Sender',
      senderAddress: null,
      receiverName: 'Receiver',
      receiverAccount: '123',
    },
  }));
}

describe('DeletionManager approval pagination', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockApiCall.mockReset();
    mockUseUiText.mockReturnValue((zh: string) => zh);
    mockUseStore.mockReturnValue({
      deletionRequests,
      setDeletionRequests: jest.fn(),
      user: { role: 'ADMIN' },
    });
    mockApiCall.mockImplementation(async (endpoint: string, options?: { body?: string }) => {
      if (endpoint === 'receipt' && options?.body?.includes('list-edit-requests')) {
        return { success: true, data: buildReceiptEditRequests(25) };
      }
      if (endpoint === 'detail' && options?.body?.includes('list-edit-requests')) {
        return { success: true, data: buildDetailEditRequests(25) };
      }
      if (endpoint === 'swift' && options?.body?.includes('list-edit-requests')) {
        return { success: true, data: buildSwiftEditRequests(25) };
      }
      return { success: true, data: deletionRequests };
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('paginates deletion requests at 20 rows per page', async () => {
    render(<DeletionManager />);

    expect(screen.getByText('reason-20')).toBeInTheDocument();
    expect(screen.queryByText('reason-21')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByLabelText('下一页 删除申请'));
    });

    expect(screen.getByText('reason-21')).toBeInTheDocument();
    expect(screen.queryByText('reason-20')).not.toBeInTheDocument();
  });

  it('paginates each edit approval section at 20 rows per page', async () => {
    render(<DeletionManager />);

    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText('R-20')).toBeInTheDocument();
    });
    expect(screen.queryByText('R-21')).not.toBeInTheDocument();
    expect(screen.queryByText('ORD-21 | $100.00')).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/下一页/).length).toBeGreaterThanOrEqual(4);
  });
});
