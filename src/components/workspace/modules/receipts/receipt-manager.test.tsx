import { act, render, screen } from '@testing-library/react';
import { ReceiptManager } from './receipt-manager';
import { apiCall, useUiText } from '@/components/workspace/shared';
import { useStore } from '@/lib/store';
import { useLocale } from 'next-intl';
import {
  useReceiptActions,
  useReceiptCustomerLookup,
  useReceiptForms,
  useReceiptGenerator,
} from './hooks';
import type { ReceiptListProps } from './components/receipt-list';
import type { ReceiptEditDialogProps } from './components/receipt-edit-dialog';

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(async () => ({ success: true, data: [] })),
  getDisplayImageUrl: jest.fn((value: string) => value),
  peekPrefetchedApiResult: jest.fn(() => null),
  rememberPrefetchedApiResult: jest.fn(),
  useUiText: jest.fn(),
}));

jest.mock('@/lib/store', () => ({
  useStore: jest.fn(),
}));

jest.mock('next-intl', () => ({
  useLocale: jest.fn(),
}));

jest.mock('./hooks', () => ({
  useReceiptCustomerLookup: jest.fn(),
  useReceiptForms: jest.fn(),
  useReceiptActions: jest.fn(),
  useReceiptGenerator: jest.fn(),
}));

jest.mock('./components', () => ({
  ReceiptDirectCreateDialog: () => null,
  ReceiptDirectImageConfirmDialog: () => null,
  ReceiptEditDialog: (props: ReceiptEditDialogProps) => {
    (globalThis as { __receiptEditDialogProps?: ReceiptEditDialogProps }).__receiptEditDialogProps = props;
    return null;
  },
  ReceiptGeneratorLaunchDialog: () => null,
  ReceiptImagePreviewDialog: () => null,
  ReceiptList: (props: ReceiptListProps) => {
    (globalThis as { __receiptListProps?: ReceiptListProps }).__receiptListProps = props;
    return null;
  },
  ReceiptUploadDialog: () => null,
}));

const mockApiCall = apiCall as jest.Mock;
const mockUseUiText = useUiText as jest.Mock;
const mockUseStore = useStore as unknown as jest.Mock;
const mockUseLocale = useLocale as jest.Mock;
const mockUseReceiptCustomerLookup = useReceiptCustomerLookup as jest.Mock;
const mockUseReceiptForms = useReceiptForms as jest.Mock;
const mockUseReceiptActions = useReceiptActions as jest.Mock;
const mockUseReceiptGenerator = useReceiptGenerator as jest.Mock;

describe('ReceiptManager', () => {
  beforeEach(() => {
    delete (globalThis as { __receiptListProps?: ReceiptListProps }).__receiptListProps;
    delete (globalThis as { __receiptEditDialogProps?: ReceiptEditDialogProps }).__receiptEditDialogProps;
    mockApiCall.mockClear();
    mockUseUiText.mockReturnValue((zh: string) => zh);
    mockUseStore.mockReturnValue({
      receipts: [],
      setReceipts: jest.fn(),
      loading: false,
      setLoading: jest.fn(),
      user: { role: 'ADMIN' },
    });
    mockUseLocale.mockReturnValue('zh');
    mockUseReceiptCustomerLookup.mockReturnValue({
      loadCustomerCandidates: jest.fn(),
    });
    mockUseReceiptForms.mockReturnValue({
      showUpload: false,
      showDirectCreate: false,
      ocrResult: null,
      setOcrResult: jest.fn(),
      ocrCustomerMark: '',
      setOcrCustomerMark: jest.fn(),
      ocrCustomerName: '',
      setOcrCustomerName: jest.fn(),
      ocrCustomerId: '',
      setOcrCustomerId: jest.fn(),
      ocrCustomerCandidates: [],
      setOcrCustomerCandidates: jest.fn(),
      imagePreview: null,
      setImagePreview: jest.fn(),
      selectedFile: null,
      setSelectedFile: jest.fn(),
      savedImagePath: null,
      setSavedImagePath: jest.fn(),
      error: null,
      setError: jest.fn(),
      directForm: {
        receiptNo: '',
        date: '',
        tel: '',
        usd: '',
        invNo: '',
        orderNo: '',
        payer: '',
        customerMark: '',
        customerName: '',
        customerId: '',
        isDeposit: false,
      },
      setDirectForm: jest.fn(),
      directCustomerCandidates: [],
      directSavedImagePath: null,
      setDirectSavedImagePath: jest.fn(),
      directUploadedImageName: '',
      setDirectUploadedImageName: jest.fn(),
      pendingDirectImageSelection: null,
      setPendingDirectImageSelection: jest.fn(),
      directUploadStatus: 'idle',
      setDirectUploadStatus: jest.fn(),
      directUploadMessage: null,
      setDirectUploadMessage: jest.fn(),
      directUploadProgress: null,
      setDirectUploadProgress: jest.fn(),
      directInvConflict: false,
      directInvConflictCount: 0,
      ocrInvConflict: false,
      ocrInvConflictCount: 0,
      viewingImage: null,
      setViewingImage: jest.fn(),
      handleShowUploadChange: jest.fn(),
      handleShowDirectCreateChange: jest.fn(),
      handleOcrCustomerMarkChange: jest.fn(),
      handleOcrCustomerSelect: jest.fn(),
      handleDirectCustomerMarkChange: jest.fn(),
      handleDirectCustomerSelect: jest.fn(),
      resetDirectForm: jest.fn(),
    });
    mockUseReceiptActions.mockReturnValue({
      uploading: false,
      directUploading: false,
      submitting: false,
      handleFileSelect: jest.fn(),
      handleConfirm: jest.fn(),
      handleDirectImageSelect: jest.fn(),
      handleConfirmDirectImageUpload: jest.fn(),
      handleMarkReceived: jest.fn(),
      handleDirectCreate: jest.fn(),
      handleDeleteReceipt: jest.fn(),
      handleSubmitReceiptEdit: jest.fn(),
      handleReviewReceiptEdit: jest.fn(),
    });
    mockUseReceiptGenerator.mockReturnValue({
      showGeneratorLaunch: false,
      setShowGeneratorLaunch: jest.fn(),
      generatorOrderNo: '',
      setGeneratorOrderNo: jest.fn(),
      generatorUsdAmount: '',
      setGeneratorUsdAmount: jest.fn(),
      generatorContext: null,
      generatorContextLoading: false,
      generatorCreating: false,
      generatorError: null,
      resetGeneratorState: jest.fn(),
      createGeneratorSession: jest.fn(),
      resumeGeneratorSession: jest.fn(),
    });
  });

  it('orders top receipt actions for mobile-first flow and enables wrapping layout', async () => {
    await act(async () => {
      render(<ReceiptManager />);
    });

    const actionGroup = screen.getByTestId('receipt-manager-primary-actions');
    const actionButtons = screen.getAllByRole('button', {
      name: /上传收据|直接创建|生成签名收据/,
    });

    expect(actionGroup).toHaveClass('flex-col', 'sm:flex-row', 'sm:flex-wrap');
    expect(actionButtons.map((button) => button.textContent?.trim())).toEqual([
      '上传收据',
      '直接创建',
      '生成签名收据',
    ]);
  });

  it('wires receipt edit affordances for sales-visible receipts', async () => {
    mockUseStore.mockReturnValue({
      receipts: [
        {
          id: 'receipt-1',
          receiptNo: 'R-1',
          date: '2026-05-04',
          tel: '123',
          usd: 100,
          invNo: 'INV-1',
          orderNo: 'ORD-1',
          payer: 'ACME',
          customerMark: 'MAB',
          status: 'SR_Received',
          imageUrl: null,
          isDeposit: false,
          isMerged: false,
          note: null,
          createdAt: '2026-05-04T00:00:00.000Z',
          creator: { id: 'sales-1', name: 'Sales', email: 'sales@example.com' },
        },
      ],
      setReceipts: jest.fn(),
      loading: false,
      setLoading: jest.fn(),
      user: { role: 'SALES' },
    });

    await act(async () => {
      render(<ReceiptManager />);
    });

    const receiptListProps = (globalThis as { __receiptListProps?: ReceiptListProps }).__receiptListProps;
    const editDialogProps = (globalThis as { __receiptEditDialogProps?: ReceiptEditDialogProps }).__receiptEditDialogProps;

    expect(receiptListProps).toBeDefined();
    expect(receiptListProps?.canEdit).toBe(true);
    expect(typeof receiptListProps?.onEditReceipt).toBe('function');
    expect(editDialogProps).toBeDefined();
    expect(editDialogProps?.isAdmin).toBe(false);
  });
});
