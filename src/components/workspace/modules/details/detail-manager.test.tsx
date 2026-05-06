import { act, render } from '@testing-library/react';
import { DetailManager } from './detail-manager';
import { apiCall, useLatestRequestGuard, useUiText } from '@/components/workspace/shared';
import { useStore } from '@/lib/store';
import { useLocale } from 'next-intl';
import { useDetailActions, useDetailForms } from './hooks';
import type { DetailListProps } from './components/detail-list';
import type { DetailEditDialogProps } from './components/detail-edit-dialog';

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
  DetailDirectCreateDialog: () => null,
  DetailEditDialog: (props: DetailEditDialogProps) => {
    (globalThis as { __detailEditDialogProps?: DetailEditDialogProps }).__detailEditDialogProps = props;
    return null;
  },
  DetailImagePreviewDialog: () => null,
  DetailList: (props: DetailListProps) => {
    (globalThis as { __detailListProps?: DetailListProps }).__detailListProps = props;
    return null;
  },
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
    mockUseStore.mockReturnValue({
      details: [
        {
          id: 'detail-1',
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
    expect(openedEditDialogProps?.form.date).toBe('2026-05-04');
    expect(openedEditDialogProps?.form.items).toEqual([
      { mark: 'MAB', orderNo: 'MAB-1-01', amount: 120, receiptId: 'receipt-1' },
    ]);
    expect(openedEditDialogProps?.linkedReceiptLabels).toEqual(['RCPT-1']);
  });
});
