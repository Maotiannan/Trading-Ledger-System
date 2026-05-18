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
  status: index < 7 ? 'PENDING' as const : 'APPROVED' as const,
  requestedBy: 'sales-1',
  approvedBy: index < 7 ? null : 'admin-1',
  createdAt: '2026-05-07T00:00:00.000Z',
  requester: { id: 'sales-1', name: `Sales ${index + 1}`, email: 'sales@example.com' },
  approver: index < 7 ? null : { id: 'admin-1', name: 'Admin', email: 'admin@example.com' },
}));

function buildReceiptEditRequests(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `receipt-edit-${index + 1}`,
    status: index < 7 ? 'PENDING' : 'APPROVED',
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
      orderNo: index === 0 ? 'ORD-UPDATED-1' : `ORD-${index + 1}`,
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
    status: index < 7 ? 'PENDING' : 'APPROVED',
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
    status: index < 7 ? 'PENDING' : 'APPROVED',
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

  it('shows only pending approval rows by default at 5 rows per page', async () => {
    render(<DeletionManager />);

    expect(screen.getByText('reason-5')).toBeInTheDocument();
    expect(screen.queryByText('reason-6')).not.toBeInTheDocument();
    expect(screen.queryByText('reason-8')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByLabelText('下一页 删除申请'));
    });

    expect(screen.getByText('reason-6')).toBeInTheDocument();
    expect(screen.queryByText('reason-5')).not.toBeInTheDocument();
  });

  it('shows all approval rows only after checking ALL and searching', async () => {
    render(<DeletionManager />);

    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText('reason-8')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByLabelText('ALL 删除申请'));
      fireEvent.click(screen.getByLabelText('查询 删除申请'));
    });

    expect(screen.getByText('reason-1')).toBeInTheDocument();
    expect(screen.queryByText('reason-6')).not.toBeInTheDocument();
  });

  it('renders only changed requested values as before and after differences', async () => {
    render(<DeletionManager />);

    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText(/ORDER NO/)).toBeInTheDocument();
    });
    expect(screen.getByText(/ORD-1 → ORD-UPDATED-1/)).toBeInTheDocument();
    expect(screen.queryByText(/Receipt No: R-1/)).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/下一页/).length).toBeGreaterThanOrEqual(4);
  });
});
