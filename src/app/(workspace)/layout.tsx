'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Sidebar, LoginPage } from '@/components/workspace/chrome';
import { useWorkspaceAuth } from '@/components/workspace/hooks';
import {
  getWorkspacePath,
  getWorkspaceViewFromPath,
  isAdminOnlyView,
  isManagerOnlyView,
} from '@/components/workspace/routes';
import { useStore } from '@/lib/store';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { initialized, user } = useWorkspaceAuth();
  const { navigationPendingView, setCurrentView, setNavigationPendingView } = useStore();
  const view = getWorkspaceViewFromPath(pathname);
  const isManager = user?.role === 'ADMIN' || user?.role === 'SALES';
  const isAdmin = user?.role === 'ADMIN';
  const forbiddenView = Boolean(user && (
    (isManagerOnlyView(view) && !isManager)
    || (isAdminOnlyView(view) && !isAdmin)
  ));

  useEffect(() => {
    if (forbiddenView) {
      setCurrentView('dashboard');
      setNavigationPendingView(null);
      router.replace(getWorkspacePath('dashboard'));
      return;
    }
    setCurrentView(view);
    setNavigationPendingView(null);
  }, [forbiddenView, router, setCurrentView, setNavigationPendingView, user, view]);

  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  if (forbiddenView) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-dvh min-h-dvh overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <div className="relative flex min-h-0 flex-1 min-w-0 flex-col">
        {navigationPendingView && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-1 bg-slate-200/70 dark:bg-slate-700/60" data-testid="workspace-main-progress">
            <div className="h-full w-1/2 animate-pulse bg-slate-900/80 dark:bg-white/80" />
          </div>
        )}
        <main className="h-full flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
