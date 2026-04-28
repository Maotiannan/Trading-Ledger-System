import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SigningView } from './signing-view';
import { apiCall } from '@/components/workspace/shared';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({ replace: jest.fn() })),
}));

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
  getErrorMessage: jest.fn((error: unknown, fallback: string) => error instanceof Error ? error.message : fallback),
}));

jest.mock('./receipt-canvas', () => ({
  ReceiptCanvas: React.forwardRef(function MockReceiptCanvas(_props: unknown, _ref) {
    return <div data-testid="receipt-canvas" />;
  }),
}));

jest.mock('./signature-pad', () => ({
  SignaturePad: ({ label, value, onChange, onBack, onConfirm, showRotateControls = true, showClearButton = true }: any) => (
    <div data-testid="signature-pad-mock">
      <div>{label}</div>
      <div data-testid="signature-pad-value">{value || 'EMPTY'}</div>
      {showRotateControls ? <div>ROTATE-CONTROLS</div> : null}
      {showClearButton ? <button type="button" onClick={() => onChange(null)}>Clear inline</button> : null}
      <button type="button" onClick={() => onChange('data:image/png;base64,new-signature')}>Draw</button>
      {onBack ? <button type="button" onClick={onBack}>Back action</button> : null}
      {onConfirm ? <button type="button" onClick={onConfirm}>Confirm action</button> : null}
    </div>
  ),
}));

jest.mock('./mobile-orientation-hint', () => ({
  MobileOrientationHint: ({ visible }: { visible: boolean }) => visible ? <div data-testid="mobile-orientation-hint" /> : null,
}));

describe('SigningView mobile signature flow', () => {
  const requestFullscreen = jest.fn().mockResolvedValue(undefined);
  const lockOrientation = jest.fn().mockResolvedValue(undefined);
  const sessionPayload = {
    data: {
      id: 'session-1',
      receiptId: 'receipt-1',
      receiptNo: '0001000',
      status: 'PENDING',
      canFinalize: true,
      layout: {
        receiptNo: '0001000',
        dateText: '27/04/2026',
        orderNo: 'Big Alpha-07',
        invNo: 'L25MH060523',
        customerMark: 'Big Alpha',
        customerName: 'Alpha Oumar Diallo',
        clientName: 'Alpha Oumar Diallo "Big Alpha"',
        clientTel: '628 38 63 63',
        usdAmount: 2500,
        amountInWords: 'Two Thousand Five Hundred USD Only',
        motif: 'Payment for L25MH060523 Big Alpha-07',
        balanceBefore: 34660,
        balanceAfter: 32160,
        resteAPayer: '$34,660 - $2,500 = $32,160#',
        receivedBy: 'Mamadou Dian Diallo',
      },
    },
  };

  const tx = (zh: string, en: string) => `${zh}|${en}`;
  const mockApiCall = apiCall as jest.Mock;
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    jest.clearAllMocks();
    mockApiCall.mockResolvedValue(sessionPayload);
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      writable: true,
      value: requestFullscreen,
    });
    Object.defineProperty(window.screen, 'orientation', {
      configurable: true,
      writable: true,
      value: { lock: lockOrientation },
    });
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 768px)',
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));
  });

  afterAll(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('shows one focused mobile signing mode at a time instead of two inline pads', async () => {
    render(<SigningView sessionId="session-1" tx={tx} />);

    await screen.findByText('签名收据|Signed Receipt');

    expect(screen.queryByTestId('receiver-signature-pad')).not.toBeInTheDocument();
    expect(screen.queryByTestId('payer-signature-pad')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始收款方签名|Start receiver signature' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始付款方签名|Start payer signature' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '开始收款方签名|Start receiver signature' }));

    const mobileMode = screen.getByTestId('mobile-signature-mode');
    expect(mobileMode).toBeInTheDocument();
    expect(within(mobileMode).getByTestId('mobile-signature-mode-title')).toHaveTextContent('收款方签名|Receiver signature');
    expect(within(mobileMode).queryByText('付款方签名|Payer signature')).not.toBeInTheDocument();
    expect(within(mobileMode).queryByText('ROTATE-CONTROLS')).not.toBeInTheDocument();
    expect(within(mobileMode).getByTestId('mobile-signature-watermark')).toHaveTextContent('Signature in the highlighted area');

    fireEvent.click(within(mobileMode).getByRole('button', { name: '全屏 / 横屏|Fullscreen / landscape' }));

    await waitFor(() => {
      expect(requestFullscreen).toHaveBeenCalled();
      expect(lockOrientation).toHaveBeenCalledWith('landscape');
    });

    fireEvent.click(within(mobileMode).getByRole('button', { name: 'Draw' }));
    fireEvent.click(within(mobileMode).getByRole('button', { name: '确认|Confirm' }));

    await waitFor(() => {
      expect(screen.queryByTestId('mobile-signature-mode')).not.toBeInTheDocument();
    });

    expect(screen.getByText('已签名|Signed')).toBeInTheDocument();
  });

  it('supports back and clear actions inside focused mobile signing mode', async () => {
    render(<SigningView sessionId="session-1" tx={tx} />);

    await screen.findByText('签名收据|Signed Receipt');

    fireEvent.click(screen.getByRole('button', { name: '开始付款方签名|Start payer signature' }));
    const mobileMode = screen.getByTestId('mobile-signature-mode');
    fireEvent.click(within(mobileMode).getByRole('button', { name: 'Draw' }));
    fireEvent.click(within(mobileMode).getByRole('button', { name: '清除|Clear' }));

    expect(within(mobileMode).getByTestId('signature-pad-value')).toHaveTextContent('EMPTY');

    fireEvent.click(within(mobileMode).getByRole('button', { name: '返回|Back' }));

    await waitFor(() => {
      expect(screen.queryByTestId('mobile-signature-mode')).not.toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: '开始付款方签名|Start payer signature' })).toBeInTheDocument();
  });
});
