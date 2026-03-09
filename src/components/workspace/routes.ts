import type { WorkspaceView } from '@/lib/store';

export type WorkspaceRouteItem = {
  id: WorkspaceView;
  path: string;
  managerOnly?: boolean;
};

export const WORKSPACE_ROUTES: WorkspaceRouteItem[] = [
  { id: 'dashboard', path: '/dashboard' },
  { id: 'invoices', path: '/invoices' },
  { id: 'receipts', path: '/receipts' },
  { id: 'details', path: '/details' },
  { id: 'swifts', path: '/swifts' },
  { id: 'deletions', path: '/deletions', managerOnly: true },
  { id: 'customers', path: '/customers', managerOnly: true },
  { id: 'settings', path: '/settings' },
  { id: 'users', path: '/settings', managerOnly: true },
];

const PATH_TO_VIEW = new Map<string, WorkspaceView>(WORKSPACE_ROUTES.map((item) => [item.path, item.id]));

export function getWorkspacePath(view: WorkspaceView): string {
  return WORKSPACE_ROUTES.find((item) => item.id === view)?.path || '/dashboard';
}

export function getWorkspaceViewFromPath(pathname: string): WorkspaceView {
  return PATH_TO_VIEW.get(pathname) || 'dashboard';
}

export function isManagerOnlyView(view: WorkspaceView): boolean {
  return Boolean(WORKSPACE_ROUTES.find((item) => item.id === view)?.managerOnly);
}
