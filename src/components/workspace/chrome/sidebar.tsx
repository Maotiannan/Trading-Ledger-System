'use client';

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiCall, useUiText } from '@/components/workspace/shared';
import { getWorkspacePath, getWorkspaceViewFromPath } from '@/components/workspace/routes';
import {
  LogOut, Users, FileText, Receipt, FileSpreadsheet,
  Building2, Trash2, LayoutDashboard, Settings, PanelLeftClose, PanelLeftOpen
} from 'lucide-react';

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'muledger-sidebar-collapsed';

export function Sidebar() {
  const t = useTranslations('sidebar');
  const tCommon = useTranslations('common');
  const tx = useUiText();
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const { user, setCurrentView, setUser } = useStore();
  const [switchingLocale, setSwitchingLocale] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const activeView = getWorkspaceViewFromPath(pathname);

  useEffect(() => {
    setCurrentView(activeView === 'users' ? 'settings' : activeView);
  }, [activeView, setCurrentView]);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) : null;
    setCollapsed(stored === '1');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  const handleLogout = async () => {
    await apiCall('auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'logout' }),
    });
    setUser(null);
    router.push('/');
  };

  const menuItems = [
    { id: 'dashboard' as const, label: t('dashboard'), icon: LayoutDashboard },
    { id: 'invoices' as const, label: t('invoices'), icon: FileText },
    { id: 'receipts' as const, label: t('receipts'), icon: Receipt },
    { id: 'details' as const, label: t('details'), icon: FileSpreadsheet },
    { id: 'swifts' as const, label: t('swifts'), icon: Building2 },
    { id: 'deletions' as const, label: t('deletions'), icon: Trash2, managerOnly: true },
    { id: 'customers' as const, label: tx('客户管理', 'Customers'), icon: Users, managerOnly: true },
    { id: 'settings' as const, label: t('settings'), icon: Settings },
  ];
  const isManager = user?.role === 'ADMIN' || user?.role === 'SALES';

  const switchLocale = async (nextLocale: 'zh' | 'en') => {
    if (nextLocale === locale) return;
    try {
      setSwitchingLocale(true);
      await fetch('/api/locale', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: nextLocale }),
      });
      window.location.reload();
    } finally {
      setSwitchingLocale(false);
    }
  };

  return (
    <div className={`bg-white dark:bg-gray-800 border-r h-screen flex flex-col transition-all duration-200 ${collapsed ? 'w-16' : 'w-64'}`}>
      <div className={`p-4 border-b ${collapsed ? 'flex justify-center' : ''}`}>
        <div className={`flex items-start ${collapsed ? 'flex-col items-center gap-3' : 'justify-between gap-3'}`}>
          <div className={collapsed ? 'flex flex-col items-center gap-2' : ''}>
            {collapsed ? (
              <div className="text-xs font-semibold tracking-wide">MU</div>
            ) : (
              <>
                <h1 className="text-xl font-bold">{tCommon('appName')}</h1>
                <p className="text-sm text-gray-500 mt-1">
                  {user?.name || user?.email}
                  <Badge variant={user?.role === 'ADMIN' ? 'default' : (user?.role === 'SALES' ? 'outline' : 'secondary')} className="ml-2">
                    {user?.role === 'ADMIN' ? tCommon('admin') : user?.role === 'SALES' ? 'SALES' : tCommon('user')}
                  </Badge>
                </p>
              </>
            )}
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setCollapsed((prev) => !prev)}
            title={collapsed ? tx('展开侧边栏', 'Expand Sidebar') : tx('收起侧边栏', 'Collapse Sidebar')}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      {!collapsed && (
        <div className="px-4 py-2 border-b">
          <p className="text-xs text-gray-500 mb-2">{t('language')}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant={locale === 'zh' ? 'default' : 'outline'} onClick={() => switchLocale('zh')} disabled={switchingLocale}>
              {tx('中文', 'Chinese')}
            </Button>
            <Button size="sm" variant={locale === 'en' ? 'default' : 'outline'} onClick={() => switchLocale('en')} disabled={switchingLocale}>
              English
            </Button>
          </div>
        </div>
      )}
      <nav className="flex-1 p-2">
        {menuItems.map((item) => {
          if (item.managerOnly && !isManager) return null;
          return (
            <Button
              key={item.id}
              variant={activeView === item.id ? 'secondary' : 'ghost'}
              className={`w-full mb-1 ${collapsed ? 'justify-center px-0' : 'justify-start'}`}
              onClick={() => router.push(getWorkspacePath(item.id))}
              title={item.label}
            >
              <item.icon className={`h-4 w-4 ${collapsed ? '' : 'mr-2'}`} />
              {!collapsed && item.label}
            </Button>
          );
        })}
      </nav>
      <div className="p-4 border-t">
        <Button variant="outline" className={`w-full ${collapsed ? 'justify-center px-0' : ''}`} onClick={handleLogout} title={tCommon('logout')}>
          <LogOut className={`h-4 w-4 ${collapsed ? '' : 'mr-2'}`} />
          {!collapsed && tCommon('logout')}
        </Button>
      </div>
    </div>
  );
}
