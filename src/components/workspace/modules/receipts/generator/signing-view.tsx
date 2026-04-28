'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ReceiptCanvas, type ReceiptCanvasHandle } from './receipt-canvas';
import { SignaturePad } from './signature-pad';
import { MobileOrientationHint } from './mobile-orientation-hint';
import { apiCall, getErrorMessage } from '@/components/workspace/shared';
import { dataUrlToBlob } from './data-url';

type SigningViewProps = {
  sessionId: string;
  tx: (zh: string, en: string) => string;
};

type MobileSignatureTarget = 'receiver' | 'payer';

type SessionPayload = {
  id: string;
  receiptId: string;
  receiptNo: string;
  status: string;
  canFinalize: boolean;
  layout: {
    receiptNo: string;
    dateText: string;
    orderNo: string;
    invNo: string | null;
    customerMark: string | null;
    customerCompanyName: string | null;
    customerName: string | null;
    clientName: string;
    clientTel: string | null;
    usdAmount: number;
    amountInWords: string;
    motif: string;
    balanceBefore: number | null;
    balanceAfter: number | null;
    resteAPayer: string;
    receivedBy: string;
  };
};

function isMobileViewport() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 768px)').matches;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function requestMobileSigningFullscreen() {
  const root = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
    msRequestFullscreen?: () => Promise<void> | void;
  };
  const orientation = window.screen.orientation as ScreenOrientation & {
    lock?: (orientation: 'landscape' | 'portrait') => Promise<void>;
  };
  const requestFullscreen = root.requestFullscreen
    || root.webkitRequestFullscreen
    || root.msRequestFullscreen;

  try {
    if (requestFullscreen) {
      await requestFullscreen.call(root);
    }
  } catch {
    // Portrait signing remains valid if fullscreen is unavailable or blocked.
  }

  try {
    await orientation.lock?.('landscape');
  } catch {
    // Orientation lock is best-effort only.
  }
}

function MobileSignatureMode({
  title,
  tx,
  value,
  onChange,
  onBack,
  onClear,
  onConfirm,
}: {
  title: string;
  tx: (zh: string, en: string) => string;
  value: string | null;
  onChange: (value: string | null) => void;
  onBack: () => void;
  onClear: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-white" data-testid="mobile-signature-mode">
      <div className="flex h-[100dvh] flex-col overflow-hidden bg-white">
        <div className="relative flex h-20 shrink-0 items-center justify-center border-b px-4">
          <Button
            type="button"
            variant="outline"
            className="absolute left-4 top-4"
            onClick={onBack}
          >
            {tx('返回', 'Back')}
          </Button>
          <div className="text-base font-semibold" data-testid="mobile-signature-mode-title">{title}</div>
          <div className="absolute right-4 top-4 flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void requestMobileSigningFullscreen();
              }}
            >
              {tx('全屏', 'Fullscreen')}
            </Button>
            <Button type="button" variant="outline" onClick={onClear}>
              {tx('清除', 'Clear')}
            </Button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div
            data-testid="mobile-signature-watermark"
            className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center px-8 text-center text-3xl font-semibold uppercase tracking-[0.35em] text-slate-200"
          >
            Signature in the highlighted area
          </div>
          <SignaturePad
            label={title}
            tx={tx}
            value={value}
            onChange={onChange}
            mobileMode
            showClearButton={false}
            hideHeader
            frameClassName="relative z-10 h-full rounded-none border-0 shadow-none"
            canvasClassName="h-full w-full"
          />
        </div>

        <div className="shrink-0 border-t bg-white px-4 py-4">
          <Button type="button" className="h-12 w-full text-base font-semibold" onClick={onConfirm}>
            {tx('完成', 'Complete')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MobileSignatureCard({
  title,
  status,
  actionLabel,
  onAction,
}: {
  title: string;
  status: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium">{title}</div>
          <div className="text-sm text-muted-foreground">{status}</div>
        </div>
        <Button type="button" onClick={onAction}>
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}

export function SigningView({ sessionId, tx }: SigningViewProps) {
  const router = useRouter();
  const canvasRef = useRef<ReceiptCanvasHandle | null>(null);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiverSignature, setReceiverSignature] = useState<string | null>(null);
  const [payerSignature, setPayerSignature] = useState<string | null>(null);
  const [mobileMode, setMobileMode] = useState(false);
  const [activeMobileSignature, setActiveMobileSignature] = useState<MobileSignatureTarget | null>(null);
  const [mobileSignatureDraft, setMobileSignatureDraft] = useState<string | null>(null);
  const [mobileSignatureCache, setMobileSignatureCache] = useState<{ receiver: string | null; payer: string | null }>({
    receiver: null,
    payer: null,
  });

  useEffect(() => {
    setMobileMode(isMobileViewport());
    const media = window.matchMedia('(max-width: 768px)');
    const listener = (event: MediaQueryListEvent) => setMobileMode(event.matches);
    media.addEventListener?.('change', listener);
    return () => media.removeEventListener?.('change', listener);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiCall(`receipt-generator?action=session&sessionId=${encodeURIComponent(sessionId)}`)
      .then((result) => {
        if (!active) return;
        setSession(result.data || null);
        setError(null);
      })
      .catch((cause) => {
        if (!active) return;
        setError(getErrorMessage(cause, tx('签名会话加载失败', 'Failed to load signing session.')));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [sessionId, tx]);

  const title = useMemo(() => session?.layout?.receiptNo || 'PENDING', [session]);

  const openMobileSignature = (target: MobileSignatureTarget) => {
    setActiveMobileSignature(target);
    setMobileSignatureDraft(
      target === 'receiver'
        ? (mobileSignatureCache.receiver ?? receiverSignature)
        : (mobileSignatureCache.payer ?? payerSignature),
    );
  };

  const closeMobileSignature = () => {
    setActiveMobileSignature(null);
    setMobileSignatureDraft(null);
  };

  const confirmMobileSignature = () => {
    if (activeMobileSignature === 'receiver') {
      setReceiverSignature(mobileSignatureDraft);
      setMobileSignatureCache((current) => ({ ...current, receiver: mobileSignatureDraft }));
    }
    if (activeMobileSignature === 'payer') {
      setPayerSignature(mobileSignatureDraft);
      setMobileSignatureCache((current) => ({ ...current, payer: mobileSignatureDraft }));
    }
    closeMobileSignature();
  };

  const activeMobileTitle = activeMobileSignature === 'receiver'
    ? tx('收款方签名', 'Receiver signature')
    : tx('付款方签名', 'Payer signature');

  const finalize = async () => {
    if (!session) return;
    if (!receiverSignature || !payerSignature) {
      setError(tx('请先完成两段签名', 'Please complete both signatures first.'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const blob = await canvasRef.current?.exportBlob();
      if (!blob) {
        throw new Error(tx('收据图片生成失败', 'Failed to render receipt image.'));
      }

      const formData = new FormData();
      formData.append('action', 'finalize');
      formData.append('sessionId', sessionId);
      formData.append('layoutSnapshot', JSON.stringify(session.layout));
      formData.append('receiptImage', new File([blob], `${session.layout.receiptNo}.png`, { type: 'image/png' }));

      const receiverBlob = dataUrlToBlob(receiverSignature);
      const payerBlob = dataUrlToBlob(payerSignature);
      formData.append('receiverSignature', new File([receiverBlob], `${session.layout.receiptNo}-receiver.png`, { type: 'image/png' }));
      formData.append('payerSignature', new File([payerBlob], `${session.layout.receiptNo}-payer.png`, { type: 'image/png' }));

      const response = await fetch('/api/receipt-generator', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw result;
      }

      downloadBlob(blob, `${session.layout.receiptNo}.png`);

      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel('receipt-generator-events');
        channel.postMessage({
          type: 'receipt-generator-finalized',
          receiptId: session.receiptId,
          sessionId,
        });
        channel.close();
      }

      if (window.opener && typeof window.opener.postMessage === 'function') {
        window.opener.postMessage({
          type: 'receipt-generator-finalized',
          receiptId: session.receiptId,
          sessionId,
        }, window.location.origin);
      }

      if (window.opener) {
        window.setTimeout(() => window.close(), 400);
      } else {
        window.setTimeout(() => router.replace('/receipts'), 400);
      }
    } catch (cause) {
      setError(getErrorMessage(cause, tx('签名收据生成失败，请重试', 'Failed to finalize signed receipt. Please retry.')));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">{tx('签名会话加载中...', 'Loading signing session...')}</div>;
  }

  if (!session) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-red-600">{error || tx('签名会话不存在', 'Signing session not found.')}</div>;
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 p-4 md:p-6">
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <div className="text-lg font-semibold">{tx('签名收据', 'Signed Receipt')}</div>
          <div className="text-sm text-muted-foreground">
            {title} / {session.layout.orderNo}
          </div>
        </div>

        <MobileOrientationHint tx={tx} visible={mobileMode} />

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <div className={`grid gap-4 ${mobileMode ? 'grid-cols-1' : 'grid-cols-[1.15fr_0.85fr]'}`}>
          <ReceiptCanvas
            ref={canvasRef}
            layout={session.layout}
            receiverSignature={receiverSignature}
            payerSignature={payerSignature}
            className={mobileMode ? 'order-2' : 'order-1'}
          />

          <div className={`space-y-4 ${mobileMode ? 'order-1' : 'order-2'}`}>
            {mobileMode ? (
              <>
                <MobileSignatureCard
                  title={tx('收款方签名', 'Receiver signature')}
                  status={receiverSignature ? tx('已签名', 'Signed') : tx('未签名', 'Not signed')}
                  actionLabel={receiverSignature ? tx('重新签名', 'Edit signature') : tx('开始收款方签名', 'Start receiver signature')}
                  onAction={() => openMobileSignature('receiver')}
                />
                <MobileSignatureCard
                  title={tx('付款方签名', 'Payer signature')}
                  status={payerSignature ? tx('已签名', 'Signed') : tx('未签名', 'Not signed')}
                  actionLabel={payerSignature ? tx('重新签名', 'Edit signature') : tx('开始付款方签名', 'Start payer signature')}
                  onAction={() => openMobileSignature('payer')}
                />
              </>
            ) : (
              <>
                <div className="rounded-xl bg-white p-4 shadow-sm" data-testid="receiver-signature-pad">
                  <SignaturePad
                    label={tx('收款方签名 / Reçu par', 'Receiver signature')}
                    tx={tx}
                    value={receiverSignature}
                    onChange={setReceiverSignature}
                    mobileMode={mobileMode}
                  />
                </div>
                <div className="rounded-xl bg-white p-4 shadow-sm" data-testid="payer-signature-pad">
                  <SignaturePad
                    label={tx('付款方签名 / Signature du payeur', 'Payer signature')}
                    tx={tx}
                    value={payerSignature}
                    onChange={setPayerSignature}
                    mobileMode={mobileMode}
                  />
                </div>
              </>
            )}

            <div className="rounded-xl bg-white p-4 shadow-sm">
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    if (window.opener) {
                      window.close();
                      return;
                    }
                    router.replace('/receipts');
                  }}
                >
                  {tx('返回', 'Back')}
                </Button>
                <Button onClick={finalize} disabled={submitting || !session.canFinalize}>
                  {submitting ? tx('生成中...', 'Generating...') : tx('确认并生成收据', 'Confirm and generate receipt')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {mobileMode && activeMobileSignature ? (
        <MobileSignatureMode
          title={activeMobileTitle}
          tx={tx}
          value={mobileSignatureDraft}
          onChange={(value) => {
            setMobileSignatureDraft(value);
            if (activeMobileSignature) {
              setMobileSignatureCache((current) => ({ ...current, [activeMobileSignature]: value }));
            }
          }}
          onBack={closeMobileSignature}
          onClear={() => {
            setMobileSignatureDraft(null);
            if (activeMobileSignature) {
              setMobileSignatureCache((current) => ({ ...current, [activeMobileSignature]: null }));
            }
          }}
          onConfirm={confirmMobileSignature}
        />
      ) : null}
    </div>
  );
}
