import type { WorkspaceView } from '@/lib/store';

export type WorkspaceRouteItem = {
  id: WorkspaceView;
  path: string;
  managerOnly?: boolean;
  adminOnly?: boolean;
};

export const WORKSPACE_ROUTES: WorkspaceRouteItem[] = [
  { id: 'dashboard', path: '/dashboard' },
  { id: 'invoices', path: '/invoices' },
  { id: 'orders', path: '/orders' },
  { id: 'receipts', path: '/receipts' },
  { id: 'details', path: '/details' },
  { id: 'swifts', path: '/swifts' },
  { id: 'emails', path: '/emails', adminOnly: true },
  { id: 'deletions', path: '/deletions', managerOnly: true },
  { id: 'customers', path: '/customers', managerOnly: true },
  { id: 'settings', path: '/settings' },
  { id: 'users', path: '/settings', managerOnly: true },
];

const PATH_TO_VIEW = new Map<string, WorkspaceView>();
for (const item of WORKSPACE_ROUTES) {
  if (!PATH_TO_VIEW.has(item.path)) {
    PATH_TO_VIEW.set(item.path, item.id);
  }
}

export function getWorkspacePath(view: WorkspaceView): string {
  return WORKSPACE_ROUTES.find((item) => item.id === view)?.path || '/dashboard';
}

export function getWorkspaceViewFromPath(pathname: string): WorkspaceView {
  return PATH_TO_VIEW.get(pathname) || 'dashboard';
}

export function isManagerOnlyView(view: WorkspaceView): boolean {
  return Boolean(WORKSPACE_ROUTES.find((item) => item.id === view)?.managerOnly);
}

export function isAdminOnlyView(view: WorkspaceView): boolean {
  return Boolean(WORKSPACE_ROUTES.find((item) => item.id === view)?.adminOnly);
}
