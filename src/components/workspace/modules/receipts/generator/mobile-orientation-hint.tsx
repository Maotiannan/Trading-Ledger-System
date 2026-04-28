'use client';

type MobileOrientationHintProps = {
  tx: (zh: string, en: string) => string;
  visible: boolean;
};

export function MobileOrientationHint({ tx, visible }: MobileOrientationHintProps) {
  if (!visible) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="mobile-orientation-hint">
      <div className="font-medium">{tx('手机签名支持竖屏，必要时可放大全屏', 'Mobile signing works in portrait, with optional fullscreen assist')}</div>
      <div className="mt-1">
        {tx('可直接竖屏签名；如果想要更大签名区域，可点击左上角按钮尝试全屏或横屏。', 'You can sign in portrait directly, or use the top-left action to try fullscreen / landscape for more space.')}
      </div>
    </div>
  );
}
