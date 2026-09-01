import {
  getWorkspacePath,
  getWorkspaceViewFromPath,
  isAdminOnlyView,
  isManagerOnlyView,
} from '@/components/workspace/routes';

describe('workspace routes', () => {
  it('keeps /settings mapped to settings even with users alias present', () => {
    expect(getWorkspaceViewFromPath('/settings')).toBe('settings');
  });

  it('keeps settings path stable', () => {
    expect(getWorkspacePath('settings')).toBe('/settings');
    expect(getWorkspacePath('users')).toBe('/settings');
  });

  it('maps the independent Orders page route', () => {
    expect(getWorkspacePath('orders')).toBe('/orders');
    expect(getWorkspaceViewFromPath('/orders')).toBe('orders');
  });

  it('maps Email Management as ADMIN-only rather than manager-only', () => {
    expect(getWorkspacePath('emails')).toBe('/emails');
    expect(getWorkspaceViewFromPath('/emails')).toBe('emails');
    expect(isAdminOnlyView('emails')).toBe(true);
    expect(isManagerOnlyView('emails')).toBe(false);
  });
});
