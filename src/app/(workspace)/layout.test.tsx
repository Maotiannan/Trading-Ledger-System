'use client';

import { render, screen, waitFor } from '@testing-library/react';
import WorkspaceLayout from './layout';

const mockReplace = jest.fn();
let mockRole: 'ADMIN' | 'SALES' | 'USER' = 'ADMIN';

jest.mock('next/navigation', () => ({
  usePathname: () => '/emails',
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock('@/components/workspace/hooks', () => ({
  useWorkspaceAuth: () => ({
    initialized: true,
    user: { id: 'user-1', email: 'user@example.com', name: 'User', role: mockRole },
  }),
}));

jest.mock('@/components/workspace/chrome', () => ({
  Sidebar: () => <aside>sidebar</aside>,
  LoginPage: () => <div>login</div>,
}));

jest.mock('@/lib/store', () => ({
  useStore: () => ({
    navigationPendingView: null,
    setCurrentView: jest.fn(),
    setNavigationPendingView: jest.fn(),
  }),
}));

describe('WorkspaceLayout Email Management guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = 'ADMIN';
  });

  it('renders Email Management content for ADMIN', () => {
    render(<WorkspaceLayout><div>email-content</div></WorkspaceLayout>);

    expect(screen.getByText('email-content')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it.each(['SALES', 'USER'] as const)('redirects %s away from a typed /emails URL', async (role) => {
    mockRole = role;
    render(<WorkspaceLayout><div>email-content</div></WorkspaceLayout>);

    expect(screen.queryByText('email-content')).not.toBeInTheDocument();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
  });
});
