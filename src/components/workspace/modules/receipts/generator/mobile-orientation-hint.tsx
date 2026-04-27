'use client';

type MobileOrientationHintProps = {
  tx: (zh: string, en: string) => string;
  visible: boolean;
};

export function MobileOrientationHint({ tx, visible }: MobileOrientationHintProps) {
  if (!visible) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <div className="font-medium">{tx('手机签名建议横屏操作', 'Landscape mode recommended for mobile signing')}</div>
      <div className="mt-1">
        {tx('如果方向不顺手，可以使用签名区的旋转按钮切换 90° / -90°。', 'If the direction feels awkward, use the rotate buttons in the signature pad to switch 90° / -90°.')}
      </div>
    </div>
  );
}
