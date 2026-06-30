'use client';

import React, { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiCall, useUiText } from '@/components/workspace/shared';
import { getWorkspacePath, getWorkspaceViewFromPath } from '@/components/workspace/routes';
import { prefetchWorkspaceView } from '@/components/workspace/navigation/prefetch';
import {
  LogOut, Users, FileText, Receipt, FileSpreadsheet,
  Building2, Trash2, LayoutDashboard, Settings, PanelLeftClose, PanelLeftOpen, Loader2, ClipboardList
} from 'lucide-react';

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'muledger-sidebar-collapsed';

export function Sidebar() {
  const t = useTranslations('sidebar');
  const tCommon = useTranslations('common');
  const tx = useUiText();
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const { user, setCurrentView, setNavigationPendingView, setUser } = useStore();
  const [switchingLocale, setSwitchingLocale] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [pendingView, setPendingView] = useState<ReturnType<typeof getWorkspaceViewFromPath> | null>(null);
  const [, startNavigationTransition] = useTransition();
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

  useEffect(() => {
    setPendingView(null);
    setNavigationPendingView(null);
  }, [pathname, setNavigationPendingView]);

  const handleLogout = async () => {
    await apiCall('auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'logout' }),
    });
    setUser(null);
    router.push('/');
  };

  const menuItems = useMemo(() => ([
    { id: 'dashboard' as const, label: t('dashboard'), icon: LayoutDashboard },
    { id: 'invoices' as const, label: t('invoices'), icon: FileText },
    { id: 'orders' as const, label: tx('订单管理', 'Orders'), icon: ClipboardList },
    { id: 'receipts' as const, label: t('receipts'), icon: Receipt },
    { id: 'details' as const, label: t('details'), icon: FileSpreadsheet },
    { id: 'swifts' as const, label: t('swifts'), icon: Building2 },
    { id: 'deletions' as const, label: t('deletions'), icon: Trash2, managerOnly: true },
    { id: 'customers' as const, label: tx('客户管理', 'Customers'), icon: Users, managerOnly: true },
    { id: 'settings' as const, label: t('settings'), icon: Settings },
  ]), [t, tx]);
  const isManager = user?.role === 'ADMIN' || user?.role === 'SALES';
  const visibleMenuItems = useMemo(
    () => menuItems.filter((item) => !(item.managerOnly && !isManager)),
    [isManager, menuItems],
  );

  const prefetchMenuItem = useCallback((view: ReturnType<typeof getWorkspaceViewFromPath>) => {
    prefetchWorkspaceView(router, view, { isManager });
  }, [isManager, router]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      visibleMenuItems.forEach((item) => {
        if (item.id !== activeView) {
          prefetchMenuItem(item.id);
        }
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [activeView, prefetchMenuItem, visibleMenuItems]);

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

  const handleNavigate = useCallback((view: ReturnType<typeof getWorkspaceViewFromPath>) => {
    const targetPath = getWorkspacePath(view);
    if (view === activeView || targetPath === pathname) {
      setPendingView(null);
      setNavigationPendingView(null);
      return;
    }
    setPendingView(view);
    setNavigationPendingView(view);
    prefetchMenuItem(view);
    startNavigationTransition(() => {
      router.push(targetPath);
    });
  }, [activeView, pathname, prefetchMenuItem, router, setNavigationPendingView]);

  return (
    <div
      data-testid="workspace-sidebar"
      className={`sticky top-0 h-dvh max-h-dvh shrink-0 overflow-hidden bg-white dark:bg-gray-800 border-r flex flex-col transition-all duration-200 ${collapsed ? 'w-16' : 'w-64'}`}
    >
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
      <nav data-testid="workspace-sidebar-nav" className="min-h-0 flex-1 overflow-y-auto p-2">
        {visibleMenuItems.map((item) => {
          const itemPending = pendingView === item.id;
          return (
            <Button
              key={item.id}
              variant={activeView === item.id || itemPending ? 'secondary' : 'ghost'}
              className={`w-full mb-1 transition-all duration-150 ${collapsed ? 'justify-center px-0' : 'justify-start'} ${itemPending ? 'scale-[0.99] ring-1 ring-black/10' : ''}`}
              onMouseEnter={() => prefetchMenuItem(item.id)}
              onFocus={() => prefetchMenuItem(item.id)}
              onClick={() => handleNavigate(item.id)}
              title={item.label}
              data-testid={`sidebar-nav-${item.id}`}
            >
              {itemPending ? (
                <Loader2 className={`h-4 w-4 animate-spin ${collapsed ? '' : 'mr-2'}`} />
              ) : (
                <item.icon className={`h-4 w-4 ${collapsed ? '' : 'mr-2'}`} />
              )}
              {!collapsed && (
                <>
                  <span>{item.label}</span>
                  {itemPending && (
                    <span className="ml-auto text-[11px] text-gray-500">
                      {tx('打开中', 'Opening')}
                    </span>
                  )}
                </>
              )}
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
