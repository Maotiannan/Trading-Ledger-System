'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiCall, getErrorMessage } from '@/components/workspace/shared';
import {
  RECEIPT_GENERATOR_RECEIVED_BY,
  type ReceiptGeneratorPaymentType,
  type ReceiptGeneratorReceivedBy,
} from '@/lib/receipt-generator-layout';

type ReceiptGeneratorContext = {
  orderNo: string;
  invNo: string | null;
  customer: {
    id: string;
    mark: string;
    companyName?: string | null;
    name: string;
    phone: string | null;
    city: string | null;
  } | null;
  balanceBefore: number | null;
  preview?: {
    balanceAfter: number | null;
  } | null;
} | null;

type ReceiptGeneratorText = (zh: string, en: string) => string;
type ReceiptPaymentMode = 'Cash' | 'Transfer';

function isMobileBrowser(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(max-width: 768px)').matches) return true;
  const ua = navigator.userAgent.toLowerCase();
  return /iphone|ipad|android|mobile/.test(ua);
}

function openSigningTarget(path: string): { mode: 'popup' | 'redirect'; popupOpened: boolean } {
  if (typeof window === 'undefined') {
    return { mode: 'redirect', popupOpened: false };
  }

  if (isMobileBrowser()) {
    window.location.href = path;
    return { mode: 'redirect', popupOpened: false };
  }

  const popup = window.open(path, 'receipt-generator-signing', 'width=1440,height=980,resizable=yes,scrollbars=yes');
  return { mode: 'popup', popupOpened: Boolean(popup) };
}

export function useReceiptGenerator(params: {
  tx: ReceiptGeneratorText;
  loadReceipts: () => Promise<void>;
  setError: (value: string | null) => void;
  openSigningTargetImpl?: (path: string) => { mode: 'popup' | 'redirect'; popupOpened: boolean };
}) {
  const { tx, loadReceipts, setError, openSigningTargetImpl = openSigningTarget } = params;
  const [showGeneratorLaunch, setShowGeneratorLaunch] = useState(false);
  const [generatorOrderNo, setGeneratorOrderNo] = useState('');
  const [generatorUsdAmount, setGeneratorUsdAmount] = useState('');
  const [generatorReceiptNo, setGeneratorReceiptNo] = useState('');
  const [generatorPaymentMode, setGeneratorPaymentMode] = useState<ReceiptPaymentMode>('Cash');
  const [generatorPaymentType, setGeneratorPaymentType] = useState<ReceiptGeneratorPaymentType>('Standard');
  const [generatorReceivedBy, setGeneratorReceivedBy] = useState<ReceiptGeneratorReceivedBy>(RECEIPT_GENERATOR_RECEIVED_BY);
  const [generatorContext, setGeneratorContext] = useState<ReceiptGeneratorContext>(null);
  const [generatorContextLoading, setGeneratorContextLoading] = useState(false);
  const [generatorCreating, setGeneratorCreating] = useState(false);
  const [generatorError, setGeneratorError] = useState<string | null>(null);
  const lastLookupToken = useRef(0);

  const channel = useMemo(() => {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
    return new BroadcastChannel('receipt-generator-events');
  }, []);

  useEffect(() => {
    if (!channel) return undefined;
    const listener = async (event: MessageEvent) => {
      if (event.data?.type === 'receipt-generator-finalized') {
        await loadReceipts();
      }
    };
    channel.addEventListener('message', listener);
    return () => {
      channel.removeEventListener('message', listener);
      channel.close();
    };
  }, [channel, loadReceipts]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const listener = async (event: MessageEvent) => {
      if (event.data?.type === 'receipt-generator-finalized') {
        await loadReceipts();
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [loadReceipts]);

  useEffect(() => {
    if (!showGeneratorLaunch || generatorReceiptNo.trim()) return;
    let cancelled = false;
    apiCall('receipt-generator?action=next-receipt-no')
      .then((result) => {
        if (cancelled) return;
        const receiptNo = typeof result.data?.receiptNo === 'string' ? result.data.receiptNo : '';
        if (receiptNo) {
          setGeneratorReceiptNo(receiptNo);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setGeneratorError(getErrorMessage(error, tx('收据号建议加载失败，提交时系统仍会自动分配', 'Failed to load receipt number suggestion. The server will still assign one on submit.')));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [generatorReceiptNo, showGeneratorLaunch, tx]);

  useEffect(() => {
    const orderNo = generatorOrderNo.trim();
    const usdAmount = generatorUsdAmount.trim();
    if (!showGeneratorLaunch || !orderNo) {
      setGeneratorContext(null);
      setGeneratorContextLoading(false);
      return;
    }

    const token = Date.now();
    lastLookupToken.current = token;
    setGeneratorContextLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          action: 'order-context',
          orderNo,
        });
        if (usdAmount) params.set('usdAmount', usdAmount);
        const result = await apiCall(`receipt-generator?${params.toString()}`);
        if (lastLookupToken.current !== token) return;
        const context = result.data || null;
        const suggestedOrderNo = typeof context?.orderNo === 'string' ? context.orderNo.trim() : '';
        if (suggestedOrderNo && suggestedOrderNo !== orderNo) {
          setGeneratorOrderNo((prev) => (prev.trim() === orderNo ? suggestedOrderNo : prev));
        }
        setGeneratorContext(context);
        setGeneratorError(null);
      } catch (error) {
        if (lastLookupToken.current !== token) return;
        setGeneratorContext(null);
        setGeneratorError(getErrorMessage(error, tx('订单匹配失败，请检查订单号', 'Order lookup failed. Check the order number.')));
      } finally {
        if (lastLookupToken.current === token) {
          setGeneratorContextLoading(false);
        }
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [generatorOrderNo, generatorUsdAmount, showGeneratorLaunch, tx]);

  const resetGeneratorState = useCallback(() => {
    setShowGeneratorLaunch(false);
    setGeneratorOrderNo('');
    setGeneratorUsdAmount('');
    setGeneratorReceiptNo('');
    setGeneratorPaymentMode('Cash');
    setGeneratorPaymentType('Standard');
    setGeneratorReceivedBy(RECEIPT_GENERATOR_RECEIVED_BY);
    setGeneratorContext(null);
    setGeneratorContextLoading(false);
    setGeneratorCreating(false);
    setGeneratorError(null);
  }, []);

  const createGeneratorSession = useCallback(async () => {
    if (!generatorOrderNo.trim()) {
      setGeneratorError(tx('ORDER NO 不能为空', 'ORDER NO is required.'));
      return;
    }
    if (!generatorUsdAmount.trim()) {
      setGeneratorError(tx('收款金额不能为空', 'USD amount is required.'));
      return;
    }
    setGeneratorCreating(true);
    setGeneratorError(null);
    setError(null);
    try {
      const result = await apiCall('receipt-generator', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create-session',
          orderNo: generatorContext?.orderNo?.trim() || generatorOrderNo.trim(),
          usdAmount: Number(generatorUsdAmount),
          paymentMode: generatorPaymentMode,
          paymentType: generatorPaymentType,
          receivedBy: generatorReceivedBy,
        }),
      });
      const signingPath = result.data?.signingPath;
      if (!signingPath || typeof signingPath !== 'string') {
        throw new Error(tx('签名页面路径缺失', 'Signing path missing.'));
      }
      const opened = openSigningTargetImpl(signingPath);
      if (opened.mode === 'redirect') {
        return;
      }
      if (opened.mode === 'popup' && !opened.popupOpened) {
        setGeneratorError(tx('浏览器拦截了签名窗口，请允许弹窗后重试。收据记录已创建，可在列表中继续签名。', 'Popup was blocked. Allow popups and retry. The receipt record has been created and can be resumed from the list.'));
      } else {
        resetGeneratorState();
      }
      await loadReceipts();
    } catch (error) {
      setGeneratorError(getErrorMessage(error, tx('创建签名收据失败，请重试', 'Failed to create signed receipt. Please retry.')));
    } finally {
      setGeneratorCreating(false);
    }
  }, [generatorContext, generatorOrderNo, generatorPaymentMode, generatorPaymentType, generatorReceivedBy, generatorUsdAmount, loadReceipts, openSigningTargetImpl, resetGeneratorState, setError, tx]);

  const resumeGeneratorSession = useCallback(async (receiptId: string) => {
    try {
      const result = await apiCall(`receipt-generator?action=resume-by-receipt&receiptId=${encodeURIComponent(receiptId)}`);
      const sessionId = result.data?.id;
      if (!sessionId || typeof sessionId !== 'string') {
        throw new Error(tx('签名会话不存在', 'Signing session not found.'));
      }
      const path = `/receipt-generator/${sessionId}`;
      const opened = openSigningTargetImpl(path);
      if (opened.mode === 'redirect') {
        return;
      }
      if (opened.mode === 'popup' && !opened.popupOpened) {
        setError(tx('浏览器拦截了签名窗口，请允许弹窗后重试。', 'Popup was blocked. Allow popups and retry.'));
      }
    } catch (error) {
      setError(getErrorMessage(error, tx('无法继续签名，请重试', 'Unable to resume signing. Please retry.')));
    }
  }, [openSigningTargetImpl, setError, tx]);

  return {
    showGeneratorLaunch,
    setShowGeneratorLaunch,
    generatorOrderNo,
    setGeneratorOrderNo,
    generatorUsdAmount,
    setGeneratorUsdAmount,
    generatorReceiptNo,
    setGeneratorReceiptNo,
    generatorPaymentMode,
    setGeneratorPaymentMode,
    generatorPaymentType,
    setGeneratorPaymentType,
    generatorReceivedBy,
    setGeneratorReceivedBy,
    generatorContext,
    generatorContextLoading,
    generatorCreating,
    generatorError,
    resetGeneratorState,
    createGeneratorSession,
    resumeGeneratorSession,
  };
}
