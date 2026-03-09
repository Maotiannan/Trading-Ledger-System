'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useStore } from '@/lib/store';
import { apiCall } from '@/components/workspace/shared';
import { LoginPage, Sidebar } from '@/components/workspace/chrome';
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

export default function HomePage() {
  const { user, setUser, currentView, setCurrentView } = useStore();
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const result = await apiCall('auth', {
          method: 'POST',
          body: JSON.stringify({ action: 'me' }),
        });
        if (result.success && result.data) {
          setUser(result.data);
        } else {
          setUser(null);
        }
      } catch {
        setUser(null);
      } finally {
        setInitialized(true);
      }
    };
    checkAuth();
  }, [setUser]);

  useEffect(() => {
    if (currentView === 'users') {
      setCurrentView('settings');
    }
  }, [currentView, setCurrentView]);

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
    switch (currentView) {
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
