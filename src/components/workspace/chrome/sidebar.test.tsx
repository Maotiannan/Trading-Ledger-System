'use client';

import { fireEvent, render, screen } from '@testing-library/react';
import { Sidebar } from './sidebar';

const mockPush = jest.fn();
const mockPrefetch = jest.fn();
let mockRole: 'ADMIN' | 'SALES' | 'USER' = 'ADMIN';

jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: mockPush, prefetch: mockPrefetch }),
}));

jest.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string) => key,
}));

jest.mock('@/lib/store', () => ({
  useStore: () => ({
    user: { id: 'admin-1', email: 'admin@example.com', name: 'Admin', role: mockRole },
    setCurrentView: jest.fn(),
    setNavigationPendingView: jest.fn(),
    setUser: jest.fn(),
  }),
}));

jest.mock('@/components/workspace/navigation/prefetch', () => ({
  prefetchWorkspaceView: jest.fn(),
}));

describe('Sidebar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = 'ADMIN';
  });

  it('stays pinned to the left viewport while the main workspace scrolls', () => {
    render(<Sidebar />);

    const sidebar = screen.getByTestId('workspace-sidebar');
    expect(sidebar).toHaveClass('sticky');
    expect(sidebar).toHaveClass('top-0');
    expect(sidebar).toHaveClass('h-dvh');
    expect(sidebar).toHaveClass('shrink-0');
    expect(screen.getByTestId('workspace-sidebar-nav')).toHaveClass('overflow-y-auto');
  });

  it('shows and opens Email Management for ADMIN', () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByTestId('sidebar-nav-emails'));

    expect(mockPush).toHaveBeenCalledWith('/emails');
  });

  it.each(['SALES', 'USER'] as const)('does not show Email Management for %s', (role) => {
    mockRole = role;
    render(<Sidebar />);

    expect(screen.queryByTestId('sidebar-nav-emails')).not.toBeInTheDocument();
  });
});
