import { render, screen } from '@testing-library/react';
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
  ReceiptGeneratorLaunchDialog: () => null,
  ReceiptImagePreviewDialog: () => null,
  ReceiptList: () => null,
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

  it('orders top receipt actions for mobile-first flow and enables wrapping layout', () => {
    render(<ReceiptManager />);

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
});
