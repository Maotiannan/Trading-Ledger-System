import { getWorkspacePath, getWorkspaceViewFromPath } from '@/components/workspace/routes';

describe('workspace routes', () => {
  it('keeps /settings mapped to settings even with users alias present', () => {
    expect(getWorkspaceViewFromPath('/settings')).toBe('settings');
  });

  it('keeps settings path stable', () => {
    expect(getWorkspacePath('settings')).toBe('/settings');
    expect(getWorkspacePath('users')).toBe('/settings');
  });
});
