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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  DASHBOARD_CARD_REGISTRY,
  hideDashboardCard,
  normalizeDashboardLayoutPreference,
  type DashboardCardId,
  type DashboardLayoutPreference,
} from '@/lib/dashboard-layout-preference';
import { formatOrderNameDisplay, formatUsdAmount } from '@/lib/display-format';
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

type DashboardReleasedInvoice = {
  id: string;
  invNo: string;
  releaseDate: string;
  daysSinceRelease: number;
  outstanding: number;
  orders: Array<{
    orderId: string;
    orderNo: string;
    amount: number;
    outstanding: number;
  }>;
};

type DashboardCustomerOutstanding = {
  customerKey: string;
  customerLabel: string;
  totalOutstanding: number;
  statusSubtotals: {
    inTransit: number;
    released: number;
  };
  orders: Array<{
    orderId: string;
    orderNo: string;
    invNo: string;
    outstanding: number;
    statusGroup: 'IN_TRANSIT' | 'RELEASED';
    releaseDate: string | null;
    daysSinceRelease: number | null;
  }>;
};

const DASHBOARD_LIST_PAGE_SIZE = 10;

function DashboardCardShell({
  cardId,
  label,
  children,
  onHide,
}: {
  cardId: DashboardCardId;
  label: string;
  children: React.ReactNode;
  onHide: (cardId: DashboardCardId) => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Hide ${label}`}
        className="absolute right-2 top-2 z-10 rounded-full p-1 text-muted-foreground/50 transition hover:bg-muted hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onHide(cardId)}
      >
        <X className="h-3.5 w-3.5" />
      </button>
      {children}
    </div>
  );
}

export function Dashboard() {
  const t = useTranslations('dashboard');
  const tx = useUiText();
  const { invoices, receipts, details, deletionRequests } = useStore();
  const dashboardRequestGuard = useLatestRequestGuard();
  const [summary, setSummary] = useState<{
    invoiceCount: number;
    unpaidTotal: number;
    pendingReceipts: number;
    pendingReceiptsAmount: number;
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
    releasedInvoices: DashboardReleasedInvoice[];
    customerOutstanding: DashboardCustomerOutstanding[];
  } | null>(null);
  const [dashboardLayout, setDashboardLayout] = useState<DashboardLayoutPreference>(() => normalizeDashboardLayoutPreference(null));
  const [releasedInvoicePage, setReleasedInvoicePage] = useState(1);
  const [customerOutstandingPage, setCustomerOutstandingPage] = useState(1);
  const [selectedCustomer, setSelectedCustomer] = useState<DashboardCustomerOutstanding | null>(null);
  const [selectedReleasedInvoice, setSelectedReleasedInvoice] = useState<DashboardReleasedInvoice | null>(null);
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

  const loadDashboardPreferences = useCallback(async () => {
    try {
      const result = await apiCall('settings?view=user-preferences');
      if (result.success && result.data) {
        setDashboardLayout(normalizeDashboardLayoutPreference((result.data as { dashboardLayout?: unknown }).dashboardLayout));
      }
    } catch {
      setDashboardLayout(normalizeDashboardLayoutPreference(null));
    }
  }, []);

  useEffect(() => {
    void loadDashboardPreferences();
  }, [loadDashboardPreferences]);

  const normalInvoices = invoices.filter((i) => i.invNo !== 'Un_Associated' && i.invNo !== 'DEPOSIT_POOL');
  const unpaidTotal = normalInvoices.reduce((sum, inv) => sum + Math.max(inv.invBalance, 0), 0);
  const invoiceCount = summary?.invoiceCount ?? normalInvoices.length;
  const pendingReceipts = summary?.pendingReceipts ?? receipts.filter(r => r.status === 'SR_Received').length;
  const pendingReceiptsAmount = summary?.pendingReceiptsAmount
    ?? receipts.filter(r => r.status === 'SR_Received').reduce((sum, receipt) => sum + Number(receipt.usd || 0), 0);
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
  const releasedInvoices = summary?.releasedInvoices ?? [];
  const customerOutstanding = summary?.customerOutstanding ?? [];

  const releasedInvoiceTotalPages = Math.max(1, Math.ceil(releasedInvoices.length / DASHBOARD_LIST_PAGE_SIZE));
  const customerOutstandingTotalPages = Math.max(1, Math.ceil(customerOutstanding.length / DASHBOARD_LIST_PAGE_SIZE));
  const paginatedReleasedInvoices = releasedInvoices.slice(
    (releasedInvoicePage - 1) * DASHBOARD_LIST_PAGE_SIZE,
    releasedInvoicePage * DASHBOARD_LIST_PAGE_SIZE,
  );
  const paginatedCustomerOutstanding = customerOutstanding.slice(
    (customerOutstandingPage - 1) * DASHBOARD_LIST_PAGE_SIZE,
    customerOutstandingPage * DASHBOARD_LIST_PAGE_SIZE,
  );
  const selectedCustomerOrdersByStatus = useMemo(() => {
    const orders = selectedCustomer?.orders ?? [];
    return {
      inTransit: orders.filter((order) => order.statusGroup === 'IN_TRANSIT'),
      released: orders.filter((order) => order.statusGroup === 'RELEASED'),
    };
  }, [selectedCustomer]);

  useEffect(() => {
    setReleasedInvoicePage((page) => Math.min(page, releasedInvoiceTotalPages));
  }, [releasedInvoiceTotalPages]);

  useEffect(() => {
    setCustomerOutstandingPage((page) => Math.min(page, customerOutstandingTotalPages));
  }, [customerOutstandingTotalPages]);
  
  const statCards: Partial<Record<DashboardCardId, {
    label: string;
    value: string | number;
    subValue?: string;
    color: string;
  }>> = {
    'invoice-balance': {
      label: tx(`账单总数 (${invoiceCount})`, `Invoice Balance (${invoiceCount})`),
      value: formatUsdAmount(summary?.unpaidTotal ?? unpaidTotal),
      color: 'text-blue-600',
    },
    'pending-receipts': {
      label: t('pendingReceipts'),
      value: pendingReceipts,
      subValue: formatUsdAmount(pendingReceiptsAmount),
      color: 'text-yellow-600',
    },
    'waiting-swift': {
      label: t('waitingSwift'),
      value: waitingSwift,
      color: 'text-orange-600',
    },
    'pending-approvals': {
      label: tx('待审批', 'Pending Approvals'),
      value: pendingDeletion,
      color: 'text-red-600',
    },
  };

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

  const renderCustomerOrderStatusSection = (
    title: string,
    orders: DashboardCustomerOutstanding['orders'],
    subtotal: number,
    variant: 'inTransit' | 'released',
  ) => {
    const isReleased = variant === 'released';
    return (
      <div className="rounded-md border">
        <div className="flex flex-col gap-2 border-b bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
          <Badge
            variant="outline"
            className={isReleased ? 'w-fit border-green-300 bg-green-50 text-green-800' : 'w-fit border-amber-300 bg-amber-50 text-amber-800'}
          >
            {title}
          </Badge>
          <span className="font-semibold text-red-600">
            {tx(`小计：${formatUsdAmount(subtotal)}`, `Subtotal: ${formatUsdAmount(subtotal)}`)}
          </span>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ORDER NO</TableHead>
                <TableHead>INV NO</TableHead>
                {isReleased && <TableHead>{tx('天数', 'Days')}</TableHead>}
                <TableHead>{tx('余额', 'Balance')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.orderId}>
                  <TableCell className="font-medium">{formatOrderNameDisplay(order.orderNo)}</TableCell>
                  <TableCell>{order.invNo}</TableCell>
                  {isReleased && <TableCell>{order.daysSinceRelease ?? '-'}</TableCell>}
                  <TableCell className="font-medium text-red-600">{formatUsdAmount(order.outstanding)}</TableCell>
                </TableRow>
              ))}
              {orders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={isReleased ? 4 : 3} className="py-6 text-center text-muted-foreground">
                    {isReleased
                      ? tx('暂无已放单未付清订单', 'No released unpaid orders')
                      : tx('暂无运输中未付清订单', 'No in-transit unpaid orders')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  };

  const dashboardCardLabel = useCallback((cardId: DashboardCardId) => {
    const card = DASHBOARD_CARD_REGISTRY.find((item) => item.id === cardId);
    return card ? tx(card.zh, card.en) : cardId;
  }, [tx]);

  const handleHideDashboardCard = useCallback(async (cardId: DashboardCardId) => {
    const confirmed = window.confirm(tx('是否隐藏此卡片？隐藏后可在设置中恢复。', 'Hide this card? You can restore it in Settings.'));
    if (!confirmed) return;

    const nextLayout = hideDashboardCard(dashboardLayout, cardId);
    try {
      const result = await apiCall('settings', {
        method: 'POST',
        body: JSON.stringify({
          action: 'update-user-preferences',
          preferences: { dashboardLayout: nextLayout },
        }),
      });
      if (result.success) {
        setDashboardLayout(normalizeDashboardLayoutPreference((result.data as { dashboardLayout?: unknown } | null)?.dashboardLayout ?? nextLayout));
      } else {
        alert(tx('保存 Dashboard 设置失败', 'Failed to save Dashboard settings'));
      }
    } catch {
      alert(tx('保存 Dashboard 设置失败', 'Failed to save Dashboard settings'));
    }
  }, [dashboardLayout, tx]);

  const wrapDashboardCard = (cardId: DashboardCardId, node: React.ReactNode) => (
    <DashboardCardShell key={cardId} cardId={cardId} label={dashboardCardLabel(cardId)} onHide={handleHideDashboardCard}>
      {node}
    </DashboardCardShell>
  );

  const renderDashboardCard = (cardId: DashboardCardId) => {
    const stat = statCards[cardId];
    if (stat) {
      return wrapDashboardCard(
        cardId,
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{stat.label}</CardDescription>
          </CardHeader>
          <CardContent className={stat.subValue ? 'flex items-end justify-between gap-3' : undefined}>
            <p className={`text-3xl font-bold ${stat.color}`}>{stat.value}</p>
            {stat.subValue && (
              <p className="text-right text-lg font-semibold text-gray-900">{stat.subValue}</p>
            )}
          </CardContent>
        </Card>,
      );
    }

    if (cardId === 'released-unpaid-invoices') {
      return wrapDashboardCard(
        cardId,
        <Card>
          <CardHeader>
            <CardTitle>{tx('已放单未结清发票', 'Released Unpaid Invoices')}</CardTitle>
            <CardDescription>{tx('按放单已过去天数从久到近排序', 'Sorted by days since release, oldest first')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>INV NO</TableHead>
                    <TableHead>{tx('放单日期', 'Release Date')}</TableHead>
                    <TableHead>{tx('已过天数', 'Days')}</TableHead>
                    <TableHead>{tx('未收金额', 'Outstanding')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedReleasedInvoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell>
                        <button
                          type="button"
                          className="font-medium text-blue-700 underline-offset-2 hover:underline"
                          onClick={() => setSelectedReleasedInvoice(invoice)}
                        >
                          {invoice.invNo}
                        </button>
                      </TableCell>
                      <TableCell>{new Date(invoice.releaseDate).toLocaleDateString()}</TableCell>
                      <TableCell>{invoice.daysSinceRelease}</TableCell>
                      <TableCell className="font-medium text-red-600">{formatUsdAmount(invoice.outstanding)}</TableCell>
                    </TableRow>
                  ))}
                  {releasedInvoices.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                        {tx('暂无已放单未结清发票', 'No released unpaid invoices')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {releasedInvoices.length > 0 && (
              <div className="flex items-center justify-end gap-2 text-sm">
                <Button variant="outline" size="sm" disabled={releasedInvoicePage === 1} onClick={() => setReleasedInvoicePage((page) => Math.max(1, page - 1))}>
                  {tx('上一页', 'Previous')}
                </Button>
                <span>{tx(`第 ${releasedInvoicePage} / ${releasedInvoiceTotalPages} 页`, `Page ${releasedInvoicePage} / ${releasedInvoiceTotalPages}`)}</span>
                <Button variant="outline" size="sm" disabled={releasedInvoicePage === releasedInvoiceTotalPages} onClick={() => setReleasedInvoicePage((page) => Math.min(releasedInvoiceTotalPages, page + 1))}>
                  {tx('下一页', 'Next')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>,
      );
    }

    if (cardId === 'customer-outstanding-ranking') {
      return wrapDashboardCard(
        cardId,
        <Card>
          <CardHeader>
            <CardTitle>{tx('客户欠款排行', 'Customer Outstanding Ranking')}</CardTitle>
            <CardDescription>{tx('按客人 ORDER_NAME 汇总所有未结清余额', 'Outstanding balance grouped by customer ORDER_NAME')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ORDER_NAME</TableHead>
                    <TableHead>{tx('未结清订单数', 'Unpaid Orders')}</TableHead>
                    <TableHead>{tx('欠款合计', 'Outstanding Total')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedCustomerOutstanding.map((customer) => (
                    <TableRow key={customer.customerKey}>
                      <TableCell>
                        <button
                          type="button"
                          className="font-medium text-blue-700 underline-offset-2 hover:underline"
                          onClick={() => {
                            setSelectedCustomer(customer);
                          }}
                        >
                          {formatOrderNameDisplay(customer.customerLabel)}
                        </button>
                      </TableCell>
                      <TableCell>{customer.orders.length}</TableCell>
                      <TableCell className="font-medium text-red-600">{formatUsdAmount(customer.totalOutstanding)}</TableCell>
                    </TableRow>
                  ))}
                  {customerOutstanding.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                        {tx('暂无客户欠款', 'No customer outstanding balance')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {customerOutstanding.length > 0 && (
              <div className="flex items-center justify-end gap-2 text-sm">
                <Button variant="outline" size="sm" disabled={customerOutstandingPage === 1} onClick={() => setCustomerOutstandingPage((page) => Math.max(1, page - 1))}>
                  {tx('上一页', 'Previous')}
                </Button>
                <span>{tx(`第 ${customerOutstandingPage} / ${customerOutstandingTotalPages} 页`, `Page ${customerOutstandingPage} / ${customerOutstandingTotalPages}`)}</span>
                <Button variant="outline" size="sm" disabled={customerOutstandingPage === customerOutstandingTotalPages} onClick={() => setCustomerOutstandingPage((page) => Math.min(customerOutstandingTotalPages, page + 1))}>
                  {tx('下一页', 'Next')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>,
      );
    }

    if (cardId === 'recent-receipts') {
      return wrapDashboardCard(
        cardId,
        <Card>
          <CardHeader>
            <CardTitle>{t('recentReceipts')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              {recentReceipts.map((receipt) => (
                <div key={receipt.id} className="flex justify-between items-center py-2 border-b">
                  <div>
                    <p className="font-medium">{receipt.orderNo ? formatOrderNameDisplay(receipt.orderNo) : receipt.receiptNo || t('unnamed')}</p>
                    <p className="text-sm text-gray-500">{formatUsdAmount(receipt.usd)}</p>
                  </div>
                  <Badge>{receipt.status}</Badge>
                </div>
              ))}
              {recentReceipts.length === 0 && <p className="text-gray-500 text-center py-4">{t('empty')}</p>}
            </ScrollArea>
          </CardContent>
        </Card>,
      );
    }

    if (cardId === 'recent-payment-details') {
      return wrapDashboardCard(
        cardId,
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
                    <p className="text-sm text-gray-500">{t('total', { value: formatUsdAmount(detail.totalAmount) })}</p>
                  </div>
                  <Badge variant={detail.status === 'ERROR' ? 'destructive' : 'default'}>{detail.status}</Badge>
                </div>
              ))}
              {recentDetails.length === 0 && <p className="text-gray-500 text-center py-4">{t('empty')}</p>}
            </ScrollArea>
          </CardContent>
        </Card>,
      );
    }

    return null;
  };

  const visibleDashboardSections = dashboardLayout.sections
    .map((section) => ({ ...section, cards: section.cards.filter((card) => card.visible) }))
    .filter((section) => section.visible && section.cards.length > 0);

  const renderDashboardSection = (section: DashboardLayoutPreference['sections'][number]) => {
    if (section.id === 'summary') {
      return (
        <div key={section.id} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {section.cards.map((card) => renderDashboardCard(card.id))}
        </div>
      );
    }
    if (section.id === 'analysis') {
      return (
        <div key={section.id} className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {section.cards.map((card) => renderDashboardCard(card.id))}
        </div>
      );
    }
    if (section.id === 'recent') {
      return (
        <div key={section.id} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {section.cards.map((card) => renderDashboardCard(card.id))}
        </div>
      );
    }
    return null;
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
      {visibleDashboardSections.map(renderDashboardSection)}

      <Dialog open={!!selectedCustomer} onOpenChange={(open) => {
        if (!open) setSelectedCustomer(null);
      }}>
        <DialogContent className="flex max-h-[calc(100vh-24px)] max-w-3xl flex-col">
          <DialogHeader>
            <DialogTitle className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <span>{formatOrderNameDisplay(selectedCustomer?.customerLabel)}</span>
              {selectedCustomer ? (
                <span className="text-sm font-semibold text-red-600">
                  {tx('未付总计', 'Total Unpaid')}: {formatUsdAmount(selectedCustomer.totalOutstanding)}
                </span>
              ) : null}
            </DialogTitle>
            <DialogDescription>
              {tx('按已放单和运输中分类查看该客户未付清 ORDER_NAME 余额', 'Unpaid ORDER_NAME balances grouped by released and in-transit status.')}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
            {renderCustomerOrderStatusSection(
              tx('已放单', 'Released'),
              selectedCustomerOrdersByStatus.released,
              selectedCustomer?.statusSubtotals.released ?? 0,
              'released',
            )}
            {renderCustomerOrderStatusSection(
              tx('运输中', 'In Transit'),
              selectedCustomerOrdersByStatus.inTransit,
              selectedCustomer?.statusSubtotals.inTransit ?? 0,
              'inTransit',
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedReleasedInvoice} onOpenChange={(open) => {
        if (!open) setSelectedReleasedInvoice(null);
      }}>
        <DialogContent className="flex max-h-[calc(100vh-24px)] max-w-3xl flex-col">
          <DialogHeader>
            <DialogTitle>{selectedReleasedInvoice?.invNo}</DialogTitle>
            <DialogDescription>
              {tx('该发票下所有 ORDER_NAME，按 OUT STANDING 从高到低排序', 'All ORDER_NAME rows under this invoice, sorted by OUT STANDING from high to low')}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ORDER_NAME</TableHead>
                    <TableHead>INV AMOUNT</TableHead>
                    <TableHead>OUT STANDING</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(selectedReleasedInvoice?.orders ?? []).map((order) => (
                    <TableRow key={order.orderId}>
                      <TableCell className="font-medium">{formatOrderNameDisplay(order.orderNo)}</TableCell>
                      <TableCell>{formatUsdAmount(order.amount)}</TableCell>
                      <TableCell className="font-medium text-red-600">{formatUsdAmount(order.outstanding)}</TableCell>
                    </TableRow>
                  ))}
                  {(selectedReleasedInvoice?.orders.length ?? 0) === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                        {tx('暂无订单', 'No orders')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
