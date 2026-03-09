'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useStore } from '@/lib/store';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  CustomerCandidate,
  IMPORT_RESULT_PAGE_SIZE,
  apiCall,
  fetchCustomerCandidatesByMark,
  fetchServerDate,
  getDisplayImageUrl,
  getErrorMessage,
  initCustomerImportRowViews,
  initInvoiceImportRowViews,
  lookupCustomerByOrderNoGroup,
  mergeCustomerImportRowViews,
  mergeInvoiceImportRowViews,
  summarizeRowsForAlert,
  toCustomerImportRowResults,
  toCustomerImportRowResultsFromIssues,
  toDateInputValue,
  toInvoiceImportRowResults,
  toInvoiceImportRowResultsFromIssues,
  useUiText,
  type CustomerImportIssueRow,
  type CustomerImportRowResult,
  type CustomerImportRowView,
  type InvoiceImportIssueRow,
  type InvoiceImportRowResult,
  type InvoiceImportRowView,
} from '@/components/workspace/shared';
import {
  Loader2, LogIn, LogOut, Users, FileText, Receipt, FileSpreadsheet,
  Building2, Trash2, Plus, Upload, Check, X, AlertTriangle, Eye,
  History, ArrowRight, RefreshCw, UserPlus, Key, LayoutDashboard, Settings, Save,
  ChevronDown, ChevronRight, Pencil
} from 'lucide-react';

export function Sidebar() {
  const t = useTranslations('sidebar');
  const tCommon = useTranslations('common');
  const tx = useUiText();
  const locale = useLocale();
  const { user, currentView, setCurrentView, setUser } = useStore();
  const [switchingLocale, setSwitchingLocale] = useState(false);

  const handleLogout = async () => {
    await apiCall('auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'logout' }),
    });
    setUser(null);
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
    <div className="w-64 bg-white dark:bg-gray-800 border-r h-screen flex flex-col">
      <div className="p-4 border-b">
        <h1 className="text-xl font-bold">{tCommon('appName')}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {user?.name || user?.email} 
          <Badge variant={user?.role === 'ADMIN' ? 'default' : (user?.role === 'SALES' ? 'outline' : 'secondary')} className="ml-2">
            {user?.role === 'ADMIN' ? tCommon('admin') : user?.role === 'SALES' ? 'SALES' : tCommon('user')}
          </Badge>
        </p>
      </div>
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
      <nav className="flex-1 p-2">
        {menuItems.map((item) => {
          if (item.managerOnly && !isManager) return null;
          return (
            <Button
              key={item.id}
              variant={currentView === item.id ? 'secondary' : 'ghost'}
              className="w-full justify-start mb-1"
              onClick={() => setCurrentView(item.id)}
            >
              <item.icon className="h-4 w-4 mr-2" />
              {item.label}
            </Button>
          );
        })}
      </nav>
      <div className="p-4 border-t">
        <Button variant="outline" className="w-full" onClick={handleLogout}>
          <LogOut className="h-4 w-4 mr-2" />
          {tCommon('logout')}
        </Button>
      </div>
    </div>
  );
}

