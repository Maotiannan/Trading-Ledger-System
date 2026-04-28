import { render, screen } from '@testing-library/react';
import { MobileOrientationHint } from './mobile-orientation-hint';

describe('MobileOrientationHint', () => {
  const tx = (zh: string, en: string) => `${zh}|${en}`;

  it('recommends fullscreen help without referring to missing rotate buttons', () => {
    render(<MobileOrientationHint tx={tx} visible />);

    expect(screen.getByText('手机签名支持竖屏，必要时可放大全屏|Mobile signing works in portrait, with optional fullscreen assist')).toBeInTheDocument();
    expect(screen.getByText('可直接竖屏签名；如果想要更大签名区域，可点击左上角按钮尝试全屏或横屏。|You can sign in portrait directly, or use the top-left action to try fullscreen / landscape for more space.')).toBeInTheDocument();
    expect(screen.queryByText(/rotate buttons/i)).not.toBeInTheDocument();
  });
});
