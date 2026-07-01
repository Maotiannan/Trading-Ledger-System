'use client';

import { fireEvent, render, screen } from '@testing-library/react';
import { ExcelTokenCard } from './excel-token-card';

describe('ExcelTokenCard', () => {
  const tx = (zh: string, _en: string) => zh;

  it('shows one-time token and invokes token actions', () => {
    const onRefresh = jest.fn();
    const onGenerate = jest.fn();
    const onRevoke = jest.fn();

    render(
      <ExcelTokenCard
        tokens={[{
          id: 'token-1',
          name: 'Excel ML',
          tokenPrefix: 'prefix123',
          createdAt: '2026-04-28T08:00:00.000Z',
          updatedAt: '2026-04-28T08:00:00.000Z',
          lastUsedAt: null,
          lastUsedIp: null,
          revokedAt: null,
          expiresAt: null,
        }]}
        oneTimeToken="ml_prefix_secret"
        loading={false}
        saving={false}
        message="Excel API令牌已生成"
        error={null}
        tx={tx}
        onRefresh={onRefresh}
        onGenerate={onGenerate}
        onRevoke={onRevoke}
      />
    );

    expect(screen.getByDisplayValue('ml_prefix_secret')).toBeInTheDocument();
    expect(screen.getByText('prefix123')).toBeInTheDocument();
    expect(screen.getByText('28/04/2026, 08:00')).toBeInTheDocument();
    expect(screen.getByText('=ML(A1,1) ORDER NAME')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /刷新/ }));
    fireEvent.click(screen.getByRole('button', { name: /重新生成/ }));
    fireEvent.click(screen.getByRole('button', { name: /撤销当前令牌/ }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onRevoke).toHaveBeenCalledWith('token-1');
  });
});
