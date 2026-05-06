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
  getApiResponseErrorMessage,
  getDisplayImageUrl,
  getErrorMessage,
  initCustomerImportRowViews,
  initInvoiceImportRowViews,
  mergeCustomerImportRowViews,
  mergeInvoiceImportRowViews,
  summarizeRowsForAlert,
  toCustomerImportRowResults,
  toCustomerImportRowResultsFromIssues,
  toDateInputValue,
  toInvoiceImportRowResults,
  toInvoiceImportRowResultsFromIssues,
  useLatestRequestGuard,
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

export function Dashboard() {
  const t = useTranslations('dashboard');
  const tx = useUiText();
  const { invoices, receipts, details, deletionRequests } = useStore();
  const dashboardRequestGuard = useLatestRequestGuard();
  const [summary, setSummary] = useState<{
    invoiceCount: number;
    unpaidTotal: number;
    pendingReceipts: number;
    waitingSwift: number;
    pendingDeletion: number;
    recentReceipts: Array<{
      id: string;
      orderNo: string | null;
      receiptNo: string | null;
      usd: number;
      status: string;
    }>;
    recentDetails: Array<{
      id: string;
      itemCount: number;
      totalAmount: number;
      status: string;
    }>;
  } | null>(null);
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  const loadSummary = useCallback(async () => {
    const requestToken = dashboardRequestGuard.nextToken();
    const result = await apiCall('dashboard?action=summary');
    if (!dashboardRequestGuard.isLatest(requestToken)) return;
    if (result.success && result.data) {
      setSummary(result.data);
    }
  }, [dashboardRequestGuard]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const normalInvoices = invoices.filter((i) => i.invNo !== 'Un_Associated' && i.invNo !== 'DEPOSIT_POOL');
  const unpaidTotal = normalInvoices.reduce((sum, inv) => sum + Math.max(inv.invBalance, 0), 0);
  const invoiceCount = summary?.invoiceCount ?? normalInvoices.length;
  const pendingReceipts = summary?.pendingReceipts ?? receipts.filter(r => r.status === 'SR_Received').length;
  const waitingSwift = summary?.waitingSwift ?? details.filter(d => d.status === 'Waiting_SWIFT').length;
  const pendingDeletion = summary?.pendingDeletion ?? deletionRequests.filter(d => d.status === 'PENDING').length;
  const recentReceipts = summary?.recentReceipts ?? receipts.slice(0, 5).map((receipt) => ({
    id: receipt.id,
    orderNo: receipt.orderNo,
    receiptNo: receipt.receiptNo,
    usd: receipt.usd,
    status: receipt.status,
  }));
  const recentDetails = summary?.recentDetails ?? details.slice(0, 5).map((detail) => ({
    id: detail.id,
    itemCount: detail.items.length,
    totalAmount: detail.totalAmount,
    status: detail.status,
  }));
  
  const stats = [
    { label: tx(`账单总数 (${invoiceCount})`, `Invoice Balance (${invoiceCount})`), value: `$${(summary?.unpaidTotal ?? unpaidTotal).toFixed(2)}`, color: 'text-blue-600' },
    { label: t('pendingReceipts'), value: pendingReceipts, color: 'text-yellow-600' },
    { label: t('waitingSwift'), value: waitingSwift, color: 'text-orange-600' },
    { label: t('pendingDeletion'), value: pendingDeletion, color: 'text-red-600' },
  ];

  const handleExport = async (format: 'excel' | 'pdf') => {
    try {
      setExporting(format);
      const response = await fetch(`/api/report?format=${format}`, {
        method: 'GET',
        credentials: 'include',
      });
      if (!response.ok) {
        alert(await getApiResponseErrorMessage(response, t('exportFailed')));
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ext = format === 'excel' ? 'xlsx' : 'pdf';
      a.href = url;
      a.download = `trading-ledger-report-${new Date().toISOString().slice(0, 10)}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      const successMessage = response.headers.get('x-success-message');
      if (successMessage) {
        try {
          alert(decodeURIComponent(successMessage));
        } catch {
          alert(successMessage);
        }
      }
    } catch {
      alert(t('exportFailedRetry'));
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold">{t('title')}</h2>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => handleExport('excel')}
            disabled={exporting !== null}
            data-testid="dashboard-export-excel"
          >
            {exporting === 'excel' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {t('exportExcel')}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleExport('pdf')}
            disabled={exporting !== null}
            data-testid="dashboard-export-pdf"
          >
            {exporting === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {t('exportPdf')}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="pb-2">
              <CardDescription>{stat.label}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className={`text-3xl font-bold ${stat.color}`}>{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('recentReceipts')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              {recentReceipts.map((receipt) => (
                <div key={receipt.id} className="flex justify-between items-center py-2 border-b">
                  <div>
                    <p className="font-medium">{receipt.orderNo || receipt.receiptNo || t('unnamed')}</p>
                    <p className="text-sm text-gray-500">${Number(receipt.usd).toFixed(2)}</p>
                  </div>
                  <Badge>{receipt.status}</Badge>
                </div>
              ))}
              {recentReceipts.length === 0 && <p className="text-gray-500 text-center py-4">{t('empty')}</p>}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('recentDetails')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              {recentDetails.map((detail) => (
                <div key={detail.id} className="flex justify-between items-center py-2 border-b">
                  <div>
                    <p className="font-medium">{t('detailItems', { count: detail.itemCount })}</p>
                    <p className="text-sm text-gray-500">{t('total', { value: Number(detail.totalAmount).toFixed(2) })}</p>
                  </div>
                  <Badge variant={detail.status === 'ERROR' ? 'destructive' : 'default'}>{detail.status}</Badge>
                </div>
              ))}
              {recentDetails.length === 0 && <p className="text-gray-500 text-center py-4">{t('empty')}</p>}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
