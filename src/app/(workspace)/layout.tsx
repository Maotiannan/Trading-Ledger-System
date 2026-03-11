'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { AppVersionFooter, Sidebar, LoginPage } from '@/components/workspace/chrome';
import { useWorkspaceAuth } from '@/components/workspace/hooks';
import { getWorkspacePath, getWorkspaceViewFromPath, isManagerOnlyView } from '@/components/workspace/routes';
import { useStore } from '@/lib/store';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { initialized, user } = useWorkspaceAuth();
  const { setCurrentView } = useStore();
  const view = getWorkspaceViewFromPath(pathname);
  const isManager = user?.role === 'ADMIN' || user?.role === 'SALES';

  useEffect(() => {
    if (user && isManagerOnlyView(view) && !isManager) {
      setCurrentView('dashboard');
      router.replace(getWorkspacePath('dashboard'));
      return;
    }
    setCurrentView(view);
  }, [isManager, router, setCurrentView, user, view]);

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

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <main className="flex-1 p-6 overflow-auto">{children}</main>
      <AppVersionFooter />
    </div>
  );
}
