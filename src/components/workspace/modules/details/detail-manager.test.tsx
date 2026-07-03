import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DetailManager } from './detail-manager';
import { apiCall, useLatestRequestGuard, useUiText } from '@/components/workspace/shared';
import { useStore } from '@/lib/store';
import { useLocale } from 'next-intl';
import { useDetailActions, useDetailForms } from './hooks';
import type { DetailListProps } from './components/detail-list';
import type { DetailEditDialogProps } from './components/detail-edit-dialog';
import type { DetailDirectCreateDialogProps } from './components/detail-direct-create-dialog';

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(async () => ({ success: true, data: [] })),
  getDisplayImageUrl: jest.fn((value: string) => value),
  peekPrefetchedApiResult: jest.fn(() => null),
  rememberPrefetchedApiResult: jest.fn(),
  useLatestRequestGuard: jest.fn(),
  useUiText: jest.fn(),
}));

jest.mock('@/lib/store', () => ({
  useStore: jest.fn(),
}));

jest.mock('next-intl', () => ({
  useLocale: jest.fn(),
}));

jest.mock('./hooks', () => ({
  useDetailForms: jest.fn(),
  useDetailActions: jest.fn(),
}));

jest.mock('./components', () => ({
  DetailDirectCreateDialog: (props: DetailDirectCreateDialogProps) => {
    (globalThis as { __detailDirectCreateDialogProps?: DetailDirectCreateDialogProps }).__detailDirectCreateDialogProps = props;
    return null;
  },
  DetailEditDialog: (props: DetailEditDialogProps) => {
    (globalThis as { __detailEditDialogProps?: DetailEditDialogProps }).__detailEditDialogProps = props;
    return null;
  },
  DetailImagePreviewDialog: () => null,
  DetailList: (props: DetailListProps) => {
    (globalThis as { __detailListProps?: DetailListProps }).__detailListProps = props;
    return null;
  },
  PaymentAgentManagerDialog: () => null,
  DetailUploadDialog: () => null,
}));

const mockApiCall = apiCall as jest.Mock;
const mockUseLatestRequestGuard = useLatestRequestGuard as jest.Mock;
const mockUseUiText = useUiText as jest.Mock;
const mockUseStore = useStore as unknown as jest.Mock;
const mockUseLocale = useLocale as jest.Mock;
const mockUseDetailForms = useDetailForms as jest.Mock;
const mockUseDetailActions = useDetailActions as jest.Mock;

describe('DetailManager', () => {
  beforeEach(() => {
    delete (globalThis as { __detailListProps?: DetailListProps }).__detailListProps;
    delete (globalThis as { __detailEditDialogProps?: DetailEditDialogProps }).__detailEditDialogProps;
    delete (globalThis as { __detailDirectCreateDialogProps?: DetailDirectCreateDialogProps }).__detailDirectCreateDialogProps;
    mockApiCall.mockClear();
    mockUseLatestRequestGuard.mockReturnValue({ nextToken: jest.fn(() => 1), isLatest: jest.fn(() => true) });
    mockUseUiText.mockReturnValue((zh: string) => zh);
    mockUseStore.mockReturnValue({
      details: [],
      setDetails: jest.fn(),
      user: { role: 'ADMIN' },
    });
    mockUseLocale.mockReturnValue('zh');
    mockUseDetailForms.mockReturnValue({
      showUpload: false,
      showDirectCreate: false,
      ocrResult: null,
      setOcrResult: jest.fn(),
      imagePreview: null,
      setImagePreview: jest.fn(),
      selectedFile: null,
      setSelectedFile: jest.fn(),
      error: null,
      setError: jest.fn(),
      savedImagePath: null,
      setSavedImagePath: jest.fn(),
      ocrUploadStatus: 'idle',
      setOcrUploadStatus: jest.fn(),
      ocrUploadMessage: null,
      setOcrUploadMessage: jest.fn(),
      ocrUploadProgress: null,
      setOcrUploadProgress: jest.fn(),
      directDate: '2026-05-05',
      setDirectDate: jest.fn(),
      directSelectedReceiptIds: [],
      setDirectSelectedReceiptIds: jest.fn(),
      directItems: [{ mark: 'MAB-1', orderNo: 'MAB-1-01', amount: '120' }],
      setDirectItems: jest.fn(),
      expandedDetails: new Set(),
      viewingImage: null,
      setViewingImage: jest.fn(),
      handleShowUploadChange: jest.fn(),
      handleShowDirectCreateChange: jest.fn(),
      toggleDetail: jest.fn(),
      resetDirectForm: jest.fn(),
    });
    mockUseDetailActions.mockReturnValue({
      uploading: false,
      submitting: false,
      handleFileSelect: jest.fn(),
      handleConfirm: jest.fn(),
      handleDeleteDetail: jest.fn(),
      handleDirectCreate: jest.fn(),
      handleSubmitDetailEdit: jest.fn(),
    });
  });

  it('wires detail edit affordances for sales and preserves editable values', async () => {
    mockApiCall.mockImplementation(async (endpoint: string) => {
      if (endpoint === 'agent') {
        return {
          success: true,
          data: [{
            id: 'agent-1',
            companyName: 'Mitty Group',
            companyAddress: null,
            contactName: null,
            contactPhone: null,
            createdBy: 'admin-1',
            createdAt: '2026-05-01T00:00:00.000Z',
            updatedAt: '2026-05-01T00:00:00.000Z',
            files: [],
          }],
        };
      }
      return { success: true, data: [] };
    });
    mockUseStore.mockReturnValue({
      details: [
        {
          id: 'detail-1',
          agentId: 'agent-1',
          date: '2026-05-04T00:00:00.000Z',
          status: 'Waiting_SWIFT',
          imageUrl: null,
          imageName: null,
          totalAmount: 120,
          createdAt: '2026-05-04T00:00:00.000Z',
          creator: { id: 'sales-1', name: 'Sales', email: 'sales@example.com' },
          items: [{
            id: 'item-1',
            mark: 'MAB',
            orderNo: 'MAB-1-01',
            amount: 120,
            receiptId: 'receipt-1',
            receipt: {
              id: 'receipt-1',
              receiptNo: 'RCPT-1',
              orderNo: 'MAB-1-01',
              payer: 'Payer A',
              usd: 120,
            },
          }],
        },
      ],
      setDetails: jest.fn(),
      user: { role: 'SALES' },
    });

    await act(async () => {
      render(<DetailManager />);
    });

    const detailListProps = (globalThis as { __detailListProps?: DetailListProps }).__detailListProps;
    const detailEditDialogProps = (globalThis as { __detailEditDialogProps?: DetailEditDialogProps }).__detailEditDialogProps;

    expect(detailListProps).toBeDefined();
    expect(detailListProps?.canEdit).toBe(true);
    expect(typeof detailListProps?.onEditDetail).toBe('function');
    expect(detailEditDialogProps?.isAdmin).toBe(false);

    await act(async () => {
      detailListProps?.onEditDetail?.({
        id: 'detail-1',
        agentId: 'agent-1',
        date: '2026-05-04T00:00:00.000Z',
        status: 'Waiting_SWIFT',
        imageUrl: null,
        imageName: null,
        totalAmount: 120,
        createdAt: '2026-05-04T00:00:00.000Z',
        creator: { id: 'sales-1', name: 'Sales', email: 'sales@example.com' },
        items: [{
          id: 'item-1',
          mark: 'MAB',
          orderNo: 'MAB-1-01',
          amount: 120,
          receiptId: 'receipt-1',
          receipt: {
            id: 'receipt-1',
            receiptNo: 'RCPT-1',
            orderNo: 'MAB-1-01',
            payer: 'Payer A',
            usd: 120,
          },
        }],
      } as never);
    });

    const openedEditDialogProps = (globalThis as { __detailEditDialogProps?: DetailEditDialogProps }).__detailEditDialogProps;
    expect(openedEditDialogProps?.agents).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'agent-1', companyName: 'Mitty Group' }),
    ]));
    expect(openedEditDialogProps?.form.agentId).toBe('agent-1');
    expect(openedEditDialogProps?.form.date).toBe('2026-05-04');
    expect(openedEditDialogProps?.form.items).toEqual([
      { mark: 'MAB', orderNo: 'MAB-1-01', amount: 120, receiptId: 'receipt-1' },
    ]);
    expect(openedEditDialogProps?.linkedReceiptLabels).toEqual(['MAB-1-01']);
  });

  it('keeps only search and the filter toggle in the mobile filter bar', async () => {
    await act(async () => {
      render(<DetailManager />);
    });

    const mobileBar = screen.getByTestId('detail-mobile-filter-bar');
    expect(mobileBar).toHaveTextContent('筛选');
    expect(mobileBar.querySelector('input[placeholder="搜索唛头/单号"]')).toBeInTheDocument();

    const mobileContent = screen.getByTestId('detail-mobile-filter-content');
    expect(mobileContent).toHaveAttribute('data-expanded', 'false');

    fireEvent.click(screen.getByRole('button', { name: '筛选' }));

    expect(screen.getByTestId('detail-mobile-filter-content')).toHaveAttribute('data-expanded', 'true');
  });

  it('loads payment details with non-received statuses by default and applies RECEIVED when selected', async () => {
    await act(async () => {
      render(<DetailManager />);
    });

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith('detail?status=Waiting_SWIFT&status=Bank_Transfer&status=ERROR');
    });

    fireEvent.click(screen.getByRole('button', { name: '状态筛选' }));
    const receivedStatus = screen.getByLabelText('RECEIVED') as HTMLInputElement;
    fireEvent.click(receivedStatus);
    await waitFor(() => {
      expect(receivedStatus.checked).toBe(true);
    });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith('detail?status=Waiting_SWIFT&status=Bank_Transfer&status=RECEIVED&status=ERROR');
    });
  });

  it('uses and persists the account payment detail page size preference', async () => {
    mockApiCall.mockImplementation(async (endpoint: string, options?: RequestInit) => {
      if (endpoint === 'settings?view=user-preferences') {
        return { success: true, data: { listPageSizes: { detail: 20, swift: 10, receipt: 20 } } };
      }
      if (endpoint === 'settings' && options?.method === 'POST') {
        return { success: true, data: { listPageSizes: { detail: 50, swift: 10, receipt: 20 } } };
      }
      return { success: true, data: [] };
    });

    await act(async () => {
      render(<DetailManager />);
    });

    await waitFor(() => {
      expect((globalThis as { __detailListProps?: DetailListProps }).__detailListProps?.pageSize).toBe(20);
    });

    await act(async () => {
      (globalThis as { __detailListProps?: DetailListProps }).__detailListProps?.onPageSizeChange(50);
    });

    expect(mockApiCall).toHaveBeenCalledWith('settings', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'update-user-preferences',
        preferences: { listPageSizes: { detail: 50 } },
      }),
    }));
  });

  it('shows generated payment detail preview names with Payment-Detail title casing', async () => {
    const setViewingImage = jest.fn();
    mockUseDetailForms.mockReturnValue({
      showUpload: false,
      showDirectCreate: false,
      ocrResult: null,
      setOcrResult: jest.fn(),
      imagePreview: null,
      setImagePreview: jest.fn(),
      selectedFile: null,
      setSelectedFile: jest.fn(),
      error: null,
      setError: jest.fn(),
      savedImagePath: null,
      setSavedImagePath: jest.fn(),
      ocrUploadStatus: 'idle',
      setOcrUploadStatus: jest.fn(),
      ocrUploadMessage: null,
      setOcrUploadMessage: jest.fn(),
      ocrUploadProgress: null,
      setOcrUploadProgress: jest.fn(),
      directDate: '2026-05-05',
      setDirectDate: jest.fn(),
      directSelectedReceiptIds: [],
      setDirectSelectedReceiptIds: jest.fn(),
      directItems: [{ mark: 'MAB-1', orderNo: 'MAB-1-01', amount: '120' }],
      setDirectItems: jest.fn(),
      expandedDetails: new Set(),
      viewingImage: null,
      setViewingImage,
      handleShowUploadChange: jest.fn(),
      handleShowDirectCreateChange: jest.fn(),
      toggleDetail: jest.fn(),
      resetDirectForm: jest.fn(),
    });
    mockUseStore.mockReturnValue({
      details: [
        {
          id: 'detail-1',
          agentId: 'agent-1',
          date: '2026-05-04T00:00:00.000Z',
          status: 'Waiting_SWIFT',
          imageUrl: '/uploads/details/payment-detail_120_2026-05-04_mitty-group.jpg',
          imageName: 'payment-detail_120_2026-05-04_mitty-group.jpg',
          totalAmount: 120,
          createdAt: '2026-05-04T00:00:00.000Z',
          creator: { id: 'sales-1', name: 'Sales', email: 'sales@example.com' },
          items: [],
        },
      ],
      setDetails: jest.fn(),
      user: { role: 'ADMIN' },
    });

    await act(async () => {
      render(<DetailManager />);
    });

    const detailListProps = (globalThis as { __detailListProps?: DetailListProps }).__detailListProps;
    detailListProps?.onViewImage({
      id: 'detail-1',
      agentId: 'agent-1',
      date: '2026-05-04T00:00:00.000Z',
      status: 'Waiting_SWIFT',
      imageUrl: '/uploads/details/payment-detail_120_2026-05-04_mitty-group.jpg',
      imageName: 'payment-detail_120_2026-05-04_mitty-group.jpg',
      totalAmount: 120,
      createdAt: '2026-05-04T00:00:00.000Z',
      creator: { id: 'sales-1', name: 'Sales', email: 'sales@example.com' },
      items: [],
    } as never);

    expect(setViewingImage).toHaveBeenCalledWith({
      url: '/api/detail?action=preview-image&detailId=detail-1',
      name: 'Payment-Detail_120_2026-05-04_mitty-group.jpg',
    });
  });

  it('loads SR_Received receipts when direct create opens and passes them into the dialog', async () => {
    mockUseDetailForms.mockReturnValue({
      showUpload: false,
      showDirectCreate: true,
      ocrResult: null,
      setOcrResult: jest.fn(),
      imagePreview: null,
      setImagePreview: jest.fn(),
      selectedFile: null,
      setSelectedFile: jest.fn(),
      error: null,
      setError: jest.fn(),
      savedImagePath: null,
      setSavedImagePath: jest.fn(),
      ocrUploadStatus: 'idle',
      setOcrUploadStatus: jest.fn(),
      ocrUploadMessage: null,
      setOcrUploadMessage: jest.fn(),
      ocrUploadProgress: null,
      setOcrUploadProgress: jest.fn(),
      directDate: '2026-05-05',
      setDirectDate: jest.fn(),
      directSelectedReceiptIds: ['receipt-1'],
      setDirectSelectedReceiptIds: jest.fn(),
      directItems: [{ mark: 'MAB-1', orderNo: 'MAB-1-01', amount: '120' }],
      setDirectItems: jest.fn(),
      expandedDetails: new Set(),
      viewingImage: null,
      setViewingImage: jest.fn(),
      handleShowUploadChange: jest.fn(),
      handleShowDirectCreateChange: jest.fn(),
      toggleDetail: jest.fn(),
      resetDirectForm: jest.fn(),
    });
    mockApiCall.mockImplementation(async (endpoint: string) => {
      if (endpoint === 'receipt?status=SR_Received') {
        return {
          success: true,
          data: [
            {
              id: 'receipt-1',
              receiptNo: '0001001',
              date: '2026-05-23',
              usd: 250,
              orderNo: 'PIKIN-20',
              payer: 'Mamadou Dian Diallo "PIKIN"',
              customerMark: 'PIKIN',
              status: 'SR_Received',
              order: { orderNo: 'PIKIN-20', customerMark: 'PIKIN' },
            },
            {
              id: 'receipt-waiting',
              receiptNo: '0001002',
              date: '2026-05-23',
              usd: 100,
              orderNo: 'OLD-01',
              payer: 'Old',
              customerMark: 'OLD',
              status: 'Waiting_SWIFT',
            },
          ],
        };
      }
      return { success: true, data: [] };
    });

    await act(async () => {
      render(<DetailManager />);
    });

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith('receipt?status=SR_Received');
    });

    const directCreateProps = (globalThis as { __detailDirectCreateDialogProps?: DetailDirectCreateDialogProps }).__detailDirectCreateDialogProps;
    expect(directCreateProps?.selectableReceipts).toEqual([
      expect.objectContaining({ id: 'receipt-1', status: 'SR_Received' }),
    ]);
    expect(mockUseDetailActions).toHaveBeenCalledWith(expect.objectContaining({
      directSelectedReceipts: [expect.objectContaining({ id: 'receipt-1' })],
    }));
  });
});
