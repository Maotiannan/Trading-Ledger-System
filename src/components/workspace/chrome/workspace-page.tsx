'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useStore, type WorkspaceView } from '@/lib/store';
import { Sidebar, LoginPage } from '@/components/workspace/chrome';
import {
  Dashboard,
  InvoiceManager,
  ReceiptManager,
  DetailManager,
  SwiftManager,
  DeletionManager,
  CustomerManager,
  SettingsManager,
} from '@/components/workspace/modules';
import { getWorkspacePath, isManagerOnlyView } from '@/components/workspace/routes';
import { useWorkspaceAuth } from '@/components/workspace/hooks/use-workspace-auth';

export function WorkspacePage({ view }: { view: WorkspaceView }) {
  const router = useRouter();
  const { initialized, user } = useWorkspaceAuth();
  const { setCurrentView } = useStore();
  const isManager = user?.role === 'ADMIN' || user?.role === 'SALES';

  useEffect(() => {
    if (view === 'users') {
      setCurrentView('settings');
      router.replace(getWorkspacePath('settings'));
      return;
    }
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

  const renderContent = () => {
    switch (view) {
      case 'dashboard':
        return <Dashboard />;
      case 'invoices':
        return <InvoiceManager />;
      case 'receipts':
        return <ReceiptManager />;
      case 'details':
        return <DetailManager />;
      case 'swifts':
        return <SwiftManager />;
      case 'deletions':
        return <DeletionManager />;
      case 'customers':
        return <CustomerManager />;
      case 'settings':
        return <SettingsManager />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <main className="flex-1 p-6 overflow-auto">
        {renderContent()}
      </main>
    </div>
  );
}
