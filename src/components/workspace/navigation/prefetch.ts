'use client';

import { prefetchApiResult } from '@/components/workspace/api/client';
import { getWorkspacePath } from '@/components/workspace/routes';
import type { WorkspaceView } from '@/lib/store';

const WORKSPACE_DATA_PREFETCHES: Partial<Record<WorkspaceView, string[]>> = {
  invoices: ['invoice'],
  orders: ['orders'],
  receipts: ['receipt'],
  details: ['detail'],
  swifts: ['swift'],
  deletions: ['deletion'],
  customers: ['customer', 'customer/fixes'],
  settings: ['settings'],
};

export function getWorkspaceDataPrefetches(view: WorkspaceView, options: { isManager?: boolean } = {}): string[] {
  if (!options.isManager && (view === 'customers' || view === 'deletions')) {
    return [];
  }
  return WORKSPACE_DATA_PREFETCHES[view] || [];
}

export function prefetchWorkspaceView(
  router: { prefetch: (href: string) => void },
  view: WorkspaceView,
  options: { isManager?: boolean } = {},
) {
  try {
    router.prefetch(getWorkspacePath(view));
  } catch {
    // Next router prefetch is best-effort.
  }

  for (const endpoint of getWorkspaceDataPrefetches(view, options)) {
    void prefetchApiResult(endpoint);
  }
}
