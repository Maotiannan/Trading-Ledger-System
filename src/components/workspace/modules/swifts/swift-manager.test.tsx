import { act, render } from '@testing-library/react';
import { SwiftManager } from './swift-manager';
import { apiCall, useLatestRequestGuard, useUiText } from '@/components/workspace/shared';
import { useStore } from '@/lib/store';
import { useLocale } from 'next-intl';
import { useSwiftActions, useSwiftForms } from './hooks';
import type { SwiftListProps } from './components/swift-list';
import type { SwiftEditDialogProps } from './components/swift-edit-dialog';

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
  useSwiftForms: jest.fn(),
  useSwiftActions: jest.fn(),
}));

jest.mock('./components', () => ({
  SwiftDirectCreateDialog: () => null,
  SwiftEditDialog: (props: SwiftEditDialogProps) => {
    (globalThis as { __swiftEditDialogProps?: SwiftEditDialogProps }).__swiftEditDialogProps = props;
    return null;
  },
  SwiftImagePreviewDialog: () => null,
  SwiftList: (props: SwiftListProps) => {
    (globalThis as { __swiftListProps?: SwiftListProps }).__swiftListProps = props;
    return null;
  },
  SwiftUploadDialog: () => null,
}));

const mockApiCall = apiCall as jest.Mock;
const mockUseLatestRequestGuard = useLatestRequestGuard as jest.Mock;
const mockUseUiText = useUiText as jest.Mock;
const mockUseStore = useStore as unknown as jest.Mock;
const mockUseLocale = useLocale as jest.Mock;
const mockUseSwiftForms = useSwiftForms as jest.Mock;
const mockUseSwiftActions = useSwiftActions as jest.Mock;

describe('SwiftManager', () => {
  beforeEach(() => {
    delete (globalThis as { __swiftListProps?: SwiftListProps }).__swiftListProps;
    delete (globalThis as { __swiftEditDialogProps?: SwiftEditDialogProps }).__swiftEditDialogProps;
    mockApiCall.mockClear();
    mockUseLatestRequestGuard.mockReturnValue({ nextToken: jest.fn(() => 1), isLatest: jest.fn(() => true) });
    mockUseUiText.mockReturnValue((zh: string) => zh);
    mockUseStore.mockReturnValue({
      swifts: [],
      setSwifts: jest.fn(),
      details: [],
      user: { role: 'ADMIN' },
    });
    mockUseLocale.mockReturnValue('zh');
    mockUseSwiftForms.mockReturnValue({
      showUpload: false,
      showDirectCreate: false,
      ocrResult: null,
      setOcrResult: jest.fn(),
      imagePreview: null,
      setImagePreview: jest.fn(),
      selectedFile: null,
      setSelectedFile: jest.fn(),
      savedImagePath: null,
      setSavedImagePath: jest.fn(),
      viewingImage: null,
      setViewingImage: jest.fn(),
      selectedDetailId: '',
      setSelectedDetailId: jest.fn(),
      error: null,
      setError: jest.fn(),
      ocrUploadStatus: 'idle',
      setOcrUploadStatus: jest.fn(),
      ocrUploadMessage: null,
      setOcrUploadMessage: jest.fn(),
      ocrUploadProgress: null,
      setOcrUploadProgress: jest.fn(),
      directForm: {
        detailId: 'detail-1',
        amount: '120',
        date: '2026-05-05',
        senderName: 'Sender',
        senderAddress: '',
        receiverName: 'Receiver',
        receiverAccount: '',
      },
      setDirectForm: jest.fn(),
      handleShowUploadChange: jest.fn(),
      handleShowDirectCreateChange: jest.fn(),
      resetDirectForm: jest.fn(),
    });
    mockUseSwiftActions.mockReturnValue({
      uploading: false,
      submitting: false,
      handleFileSelect: jest.fn(),
      handleConfirm: jest.fn(),
      handleDeleteSwift: jest.fn(),
      handleDirectCreate: jest.fn(),
      handleSubmitSwiftEdit: jest.fn(),
    });
  });

  it('wires swift edit affordances for sales and preserves editable values', async () => {
    mockUseStore.mockReturnValue({
      swifts: [
        {
          id: 'swift-1',
          detailId: 'detail-1',
          amount: 330,
          date: '2026-05-04T00:00:00.000Z',
          senderName: 'Sender A',
          senderAddress: 'Conakry',
          receiverName: 'Receiver B',
          receiverAccount: 'ACC-1',
          imageUrl: null,
          status: 'Bank_Transfer',
          hasError: false,
          errorMessage: null,
          createdAt: '2026-05-04T00:00:00.000Z',
        },
      ],
      setSwifts: jest.fn(),
      details: [],
      user: { role: 'SALES' },
    });

    await act(async () => {
      render(<SwiftManager />);
    });

    const swiftListProps = (globalThis as { __swiftListProps?: SwiftListProps }).__swiftListProps;
    const swiftEditDialogProps = (globalThis as { __swiftEditDialogProps?: SwiftEditDialogProps }).__swiftEditDialogProps;

    expect(swiftListProps).toBeDefined();
    expect(swiftListProps?.canEdit).toBe(true);
    expect(typeof swiftListProps?.onEditSwift).toBe('function');
    expect(swiftEditDialogProps?.isAdmin).toBe(false);

    await act(async () => {
      swiftListProps?.onEditSwift?.({
        id: 'swift-1',
        detailId: 'detail-1',
        amount: 330,
        date: '2026-05-04T00:00:00.000Z',
        senderName: 'Sender A',
        senderAddress: 'Conakry',
        receiverName: 'Receiver B',
        receiverAccount: 'ACC-1',
        imageUrl: null,
        status: 'Bank_Transfer',
        hasError: false,
        errorMessage: null,
        createdAt: '2026-05-04T00:00:00.000Z',
      } as never);
    });

    const openedEditDialogProps = (globalThis as { __swiftEditDialogProps?: SwiftEditDialogProps }).__swiftEditDialogProps;
    expect(openedEditDialogProps?.form.date).toBe('2026-05-04');
    expect(openedEditDialogProps?.form.amount).toBe(330);
    expect(openedEditDialogProps?.form.senderName).toBe('Sender A');
    expect(openedEditDialogProps?.form.receiverAccount).toBe('ACC-1');
  });
});
