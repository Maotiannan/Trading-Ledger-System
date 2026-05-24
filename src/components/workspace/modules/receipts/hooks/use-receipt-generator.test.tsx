import { act, renderHook } from '@testing-library/react';
import { apiCall, getErrorMessage } from '@/components/workspace/shared';
import { useReceiptGenerator } from './use-receipt-generator';

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
  getErrorMessage: jest.fn((error: unknown, fallback: string) => error instanceof Error ? error.message : fallback),
}));

const mockApiCall = apiCall as jest.Mock;
const mockGetErrorMessage = getErrorMessage as jest.Mock;
const globalWithBroadcastChannel = global as typeof globalThis & {
  BroadcastChannel: typeof BroadcastChannel | undefined;
};

class MockBroadcastChannel {
  addEventListener = jest.fn();
  removeEventListener = jest.fn();
  close = jest.fn();
  postMessage = jest.fn();
}

describe('useReceiptGenerator', () => {
  const tx = (zh: string, _en: string) => zh;
  const loadReceipts = jest.fn(async () => undefined);
  const setError = jest.fn();
  const originalMatchMedia = window.matchMedia;
  const originalBroadcastChannel = global.BroadcastChannel;

  beforeEach(() => {
    jest.clearAllMocks();
    mockApiCall.mockReset();
    mockGetErrorMessage.mockClear();
    loadReceipts.mockClear();
    setError.mockClear();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: jest.fn().mockImplementation((query: string) => ({
        matches: query === '(max-width: 768px)',
        media: query,
        onchange: null,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        addListener: jest.fn(),
        removeListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36 SamsungBrowser/25.0',
    });
    globalWithBroadcastChannel.BroadcastChannel = MockBroadcastChannel as unknown as typeof BroadcastChannel;

  });

  afterAll(() => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
    globalWithBroadcastChannel.BroadcastChannel = originalBroadcastChannel;
  });

  it('does not keep reloading the receipt list after starting a mobile signing redirect', async () => {
    mockApiCall.mockResolvedValue({
      data: {
        signingPath: '/receipt-generator/session-mobile',
      },
    });
    const openSigningTargetImpl = jest.fn(() => ({ mode: 'redirect' as const, popupOpened: false }));

    const { result } = renderHook(() => useReceiptGenerator({ tx, loadReceipts, setError, openSigningTargetImpl }));

    await act(async () => {
      result.current.setShowGeneratorLaunch(true);
      result.current.setGeneratorOrderNo('MOBILE-01');
      result.current.setGeneratorUsdAmount('1234');
      result.current.setGeneratorReceiptNo('0010000');
      result.current.setGeneratorPaymentMode('Transfer');
    });

    await act(async () => {
      await result.current.createGeneratorSession();
    });

    expect(openSigningTargetImpl).toHaveBeenCalledWith('/receipt-generator/session-mobile');
    expect(mockApiCall).toHaveBeenCalledWith('receipt-generator', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'create-session',
        orderNo: 'MOBILE-01',
        usdAmount: 1234,
        paymentMode: 'Transfer',
      }),
    }));
    expect(loadReceipts).not.toHaveBeenCalled();
    expect(result.current.showGeneratorLaunch).toBe(true);
    expect(result.current.generatorOrderNo).toBe('MOBILE-01');
  });

  it('loads the suggested receipt number when the generator dialog opens', async () => {
    mockApiCall.mockResolvedValueOnce({
      data: {
        receiptNo: '0010000',
      },
    });

    const { result } = renderHook(() => useReceiptGenerator({ tx, loadReceipts, setError }));

    await act(async () => {
      result.current.setShowGeneratorLaunch(true);
      await Promise.resolve();
    });

    expect(mockApiCall).toHaveBeenCalledWith('receipt-generator?action=next-receipt-no');
    expect(result.current.generatorReceiptNo).toBe('0010000');
  });

  it('lets the server assign the receipt number when creating a signing session', async () => {
    mockApiCall.mockResolvedValue({
      data: {
        signingPath: '/receipt-generator/session-custom',
      },
    });
    const openSigningTargetImpl = jest.fn(() => ({ mode: 'popup' as const, popupOpened: true }));

    const { result } = renderHook(() => useReceiptGenerator({ tx, loadReceipts, setError, openSigningTargetImpl }));

    await act(async () => {
      result.current.setShowGeneratorLaunch(true);
      result.current.setGeneratorOrderNo('PIKIN-20');
      result.current.setGeneratorUsdAmount('2500');
    });

    await act(async () => {
      await result.current.createGeneratorSession();
    });

    expect(mockApiCall).toHaveBeenCalledWith('receipt-generator', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'create-session',
        orderNo: 'PIKIN-20',
        usdAmount: 2500,
        paymentMode: 'Cash',
      }),
    }));
  });

  it('replaces generator ORDER NO with the full matched composite order from context', async () => {
    jest.useFakeTimers();
    mockApiCall.mockResolvedValue({
      data: {
        orderNo: 'AB-13B/AB-12B',
        invNo: 'L25MH060992C',
        customer: { id: 'customer-ab', mark: 'AB', name: 'Abdoulaye Barry', phone: '+224 664 51 79 52' },
        balanceBefore: 10000,
        preview: { balanceAfter: 6800 },
      },
    });
    const { result } = renderHook(() => useReceiptGenerator({ tx, loadReceipts, setError }));

    await act(async () => {
      result.current.setShowGeneratorLaunch(true);
      result.current.setGeneratorOrderNo('AB-13B');
      result.current.setGeneratorUsdAmount('3200');
    });

    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.generatorOrderNo).toBe('AB-13B/AB-12B');
    expect(result.current.generatorContext?.invNo).toBe('L25MH060992C');
    jest.useRealTimers();
  });
});
