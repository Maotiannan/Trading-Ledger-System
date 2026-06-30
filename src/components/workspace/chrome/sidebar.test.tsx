'use client';

import { render, screen } from '@testing-library/react';
import { Sidebar } from './sidebar';

jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: jest.fn(), prefetch: jest.fn() }),
}));

jest.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string) => key,
}));

jest.mock('@/lib/store', () => ({
  useStore: () => ({
    user: { id: 'admin-1', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
    setCurrentView: jest.fn(),
    setNavigationPendingView: jest.fn(),
    setUser: jest.fn(),
  }),
}));

jest.mock('@/components/workspace/navigation/prefetch', () => ({
  prefetchWorkspaceView: jest.fn(),
}));

describe('Sidebar', () => {
  it('stays pinned to the left viewport while the main workspace scrolls', () => {
    render(<Sidebar />);

    const sidebar = screen.getByTestId('workspace-sidebar');
    expect(sidebar).toHaveClass('sticky');
    expect(sidebar).toHaveClass('top-0');
    expect(sidebar).toHaveClass('h-dvh');
    expect(sidebar).toHaveClass('shrink-0');
    expect(screen.getByTestId('workspace-sidebar-nav')).toHaveClass('overflow-y-auto');
  });
});
