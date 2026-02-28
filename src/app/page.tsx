'use client';

import { useState, useEffect, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { useLocale, useTranslations } from 'next-intl';
import { deriveOrderGroupKey } from '@/lib/order-group';
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
  Loader2, LogIn, LogOut, Users, FileText, Receipt, FileSpreadsheet, 
  Building2, Trash2, Plus, Upload, Check, X, AlertTriangle, Eye, 
  History, ArrowRight, RefreshCw, UserPlus, Key, LayoutDashboard, Settings, Save,
  ChevronDown, ChevronRight, Pencil
} from 'lucide-react';

// API调用辅助函数
async function apiCall(endpoint: string, options: RequestInit = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const response = await fetch(`/api/${endpoint}`, {
    ...options,
    credentials: 'include',
    headers,
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof json?.error === 'string' ? json.error : `HTTP ${response.status}`;
    throw new Error(message);
  }

  return json;
}

async function lookupCustomerByOrderNoGroup(orderNoInput: string): Promise<{ mark: string; name: string; customerId: string } | null> {
  const normalized = orderNoInput.trim();
  if (!normalized) return null;
  const result = await apiCall(`invoice?orderNo=${encodeURIComponent(normalized)}`);
  if (!result.success || !Array.isArray(result.data)) return null;
  const inputGroupKey = deriveOrderGroupKey(normalized);
  if (!inputGroupKey) return null;

  const markMap = new Map<string, { mark: string; name: string; customerId: string }>();
  for (const row of result.data as Array<Record<string, unknown>>) {
    const rowOrderNo = String(row.orderNo || '');
    if (!rowOrderNo || deriveOrderGroupKey(rowOrderNo) !== inputGroupKey) continue;
    const mark = String(row.customerMark || '').trim();
    if (!mark) continue;
    const key = mark.toLowerCase();
    if (!markMap.has(key)) {
      markMap.set(key, {
        mark,
        name: String(row.customerName || ''),
        customerId: String(row.customerId || ''),
      });
    }
  }

  if (markMap.size === 1) {
    return Array.from(markMap.values())[0];
  }
  return null;
}

// 登录组件
function LoginPage() {
  const t = useTranslations('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { setUser } = useStore();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await apiCall('auth', {
        method: 'POST',
        body: JSON.stringify({ action: 'login', email, password }),
      });

      if (result.success && result.data) {
        setUser(result.data);
      } else {
        setError(result.error || t('loginFailed'));
      }
    } catch (err) {
      if (err instanceof Error && err.message) {
        setError(err.message);
      } else {
        setError(t('networkError'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">{t('title')}</CardTitle>
          <CardDescription>{t('subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('email')}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('password')}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••"
                required
              />
            </div>
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <LogIn className="h-4 w-4 mr-2" />}
              {t('submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// 侧边导航栏
function Sidebar() {
  const t = useTranslations('sidebar');
  const tCommon = useTranslations('common');
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
    { id: 'users' as const, label: t('users'), icon: Users, managerOnly: true },
    { id: 'customers' as const, label: '客户管理', icon: Users, managerOnly: true },
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
            中文
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

// 仪表盘
function Dashboard() {
  const t = useTranslations('dashboard');
  const { invoices, receipts, details, deletionRequests } = useStore();
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  const normalInvoices = invoices.filter((i) => i.invNo !== 'Un_Associated' && i.invNo !== 'DEPOSIT_POOL');
  const unpaidTotal = normalInvoices.reduce((sum, inv) => sum + Math.max(inv.invBalance, 0), 0);
  
  const stats = [
    { label: `账单总数 (${normalInvoices.length})`, value: `$${unpaidTotal.toFixed(2)}`, color: 'text-blue-600' },
    { label: t('pendingReceipts'), value: receipts.filter(r => r.status === 'SR_Received').length, color: 'text-yellow-600' },
    { label: t('waitingSwift'), value: details.filter(d => d.status === 'Waiting_SWIFT').length, color: 'text-orange-600' },
    { label: t('pendingDeletion'), value: deletionRequests.filter(d => d.status === 'PENDING').length, color: 'text-red-600' },
  ];

  const handleExport = async (format: 'excel' | 'pdf') => {
    try {
      setExporting(format);
      const response = await fetch(`/api/report?format=${format}`, {
        method: 'GET',
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        alert(error.error || t('exportFailed'));
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
    } catch {
      alert(t('exportFailedRetry'));
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t('title')}</h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => handleExport('excel')}
            disabled={exporting !== null}
          >
            {exporting === 'excel' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {t('exportExcel')}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleExport('pdf')}
            disabled={exporting !== null}
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
              {receipts.slice(0, 5).map((receipt) => (
                <div key={receipt.id} className="flex justify-between items-center py-2 border-b">
                  <div>
                    <p className="font-medium">{receipt.orderNo || receipt.receiptNo || t('unnamed')}</p>
                    <p className="text-sm text-gray-500">${receipt.usd.toFixed(2)}</p>
                  </div>
                  <Badge>{receipt.status}</Badge>
                </div>
              ))}
              {receipts.length === 0 && <p className="text-gray-500 text-center py-4">{t('empty')}</p>}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('recentDetails')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              {details.slice(0, 5).map((detail) => (
                <div key={detail.id} className="flex justify-between items-center py-2 border-b">
                  <div>
                    <p className="font-medium">{t('detailItems', { count: detail.items.length })}</p>
                    <p className="text-sm text-gray-500">{t('total', { value: detail.totalAmount.toFixed(2) })}</p>
                  </div>
                  <Badge variant={detail.status === 'ERROR' ? 'destructive' : 'default'}>{detail.status}</Badge>
                </div>
              ))}
              {details.length === 0 && <p className="text-gray-500 text-center py-4">{t('empty')}</p>}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// 账单管理
function InvoiceManager() {
  const { invoices, setInvoices, loading, setLoading, user } = useStore();
  const [search, setSearch] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [invNo, setInvNo] = useState('');
  const [customerMark, setCustomerMark] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerCandidates, setCustomerCandidates] = useState<Array<{ id: string; mark: string; name: string }>>([]);
  const [orders, setOrders] = useState<{ orderNo: string; amount: string }[]>([{ orderNo: '', amount: '' }]);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  // 展开状态
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());
  
  // 编辑订单对话框
  const [editingOrder, setEditingOrder] = useState<{
    id: string;
    orderNo: string;
    amount: number;
    invoiceId: string;
    customerMark: string;
    customerName: string;
    customerPhone: string;
    customerCity: string;
    customerId: string;
  } | null>(null);
  const [showOrderDialog, setShowOrderDialog] = useState(false);
  const [orderFormError, setOrderFormError] = useState('');
  
  // 添加订单到现有账单
  const [addingOrderToInvoice, setAddingOrderToInvoice] = useState<string | null>(null);
  const [newOrderNo, setNewOrderNo] = useState('');
  const [newOrderAmount, setNewOrderAmount] = useState('');
  const [newOrderCustomerMark, setNewOrderCustomerMark] = useState('');
  const [newOrderCustomerName, setNewOrderCustomerName] = useState('');
  const [newOrderCustomerId, setNewOrderCustomerId] = useState('');
  const [newOrderCustomerCandidates, setNewOrderCustomerCandidates] = useState<Array<{ id: string; mark: string; name: string }>>([]);
  const [addError, setAddError] = useState('');
  
  // 转移余额对话框
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [transferFromOrder, setTransferFromOrder] = useState<{ id: string; orderNo: string; balance: number } | null>(null);
  const [transferToOrderNo, setTransferToOrderNo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferError, setTransferError] = useState('');
  
  // 刷新匹配状态
  const [refreshing, setRefreshing] = useState(false);
  const [orderHistoryOpen, setOrderHistoryOpen] = useState(false);
  const [orderHistoryTitle, setOrderHistoryTitle] = useState('');
  const [orderHistoryRows, setOrderHistoryRows] = useState<Array<Record<string, unknown>>>([]);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    const result = await apiCall(`invoice${params.toString() ? `?${params.toString()}` : ''}`);
    if (result.success) {
      setInvoices(result.data);
    }
    setLoading(false);
  }, [setInvoices, setLoading, search]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  const loadCustomerCandidates = async (
    mark: string,
    setter: (rows: Array<{ id: string; mark: string; name: string }>) => void,
    setDefaultName?: (value: string) => void,
    setDefaultId?: (value: string) => void
  ) => {
    const normalized = mark.trim();
    if (!normalized) {
      setter([]);
      if (setDefaultName) setDefaultName('');
      if (setDefaultId) setDefaultId('');
      return;
    }
    try {
      const result = await apiCall(`customer?mark=${encodeURIComponent(normalized)}`);
      if (!result.success || !Array.isArray(result.data)) {
        setter([]);
        return;
      }
      const rows = result.data.map((row: { id: string; mark: string; name: string }) => ({
        id: row.id,
        mark: row.mark,
        name: row.name,
      }));
      setter(rows);
      if (rows.length === 1) {
        if (setDefaultName) setDefaultName(rows[0].name);
        if (setDefaultId) setDefaultId(rows[0].id);
      }
    } catch {
      setter([]);
    }
  };

  const openOrderHistory = async (orderId: string, orderNo: string) => {
    try {
      const result = await apiCall(`invoice?orderId=${encodeURIComponent(orderId)}`);
      if (result.success) {
        setOrderHistoryRows(Array.isArray(result.data) ? result.data : []);
        setOrderHistoryTitle(orderNo);
        setOrderHistoryOpen(true);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : '加载付款记录失败');
    }
  };

  // 刷新匹配
  const handleRematch = async () => {
    setRefreshing(true);
    try {
      const result = await apiCall('invoice', {
        method: 'PUT',
        body: JSON.stringify({ action: 'rematch' }),
      });
      
      if (result.success) {
        alert(result.message || '刷新成功');
        await loadInvoices();
      } else {
        alert(result.error || '刷新失败');
      }
    } catch (err) {
      alert('网络错误，请重试');
      console.error(err);
    } finally {
      setRefreshing(false);
    }
  };

  const toggleInvoice = (invoiceId: string) => {
    const newExpanded = new Set(expandedInvoices);
    if (newExpanded.has(invoiceId)) {
      newExpanded.delete(invoiceId);
    } else {
      newExpanded.add(invoiceId);
    }
    setExpandedInvoices(newExpanded);
  };

  const handleCreateInvoice = async () => {
    setFormError('');
    
    if (!invNo.trim()) {
      setFormError('请输入账单号');
      return;
    }
    if (!customerMark.trim()) {
      setFormError('请输入客户MARK');
      return;
    }
    
    if (orders.some(o => !o.orderNo.trim() || !o.amount)) {
      setFormError('请填写所有订单的客户单号和金额');
      return;
    }

    setSubmitting(true);
    
    try {
      const result = await apiCall('invoice', {
        method: 'POST',
        body: JSON.stringify({
          invNo,
          customerMark,
          customerName: customerName || null,
          customerId: selectedCustomerId || null,
          orders: orders.map(o => ({ orderNo: o.orderNo, amount: parseFloat(o.amount) }))
        }),
      });

      if (result.success) {
        setShowDialog(false);
        setInvNo('');
        setCustomerMark('');
        setCustomerName('');
        setSelectedCustomerId('');
        setCustomerCandidates([]);
        setOrders([{ orderNo: '', amount: '' }]);
        // 显示合并消息（如果有）
        if (result.message) {
          alert(result.message);
        }
        loadInvoices();
      } else {
        setFormError(result.error || '创建失败');
      }
    } catch (err) {
      setFormError('网络错误，请重试');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateOrder = async () => {
    if (!editingOrder) return;
    setOrderFormError('');
    
    if (!editingOrder.orderNo.trim()) {
      setOrderFormError('请输入客户单号');
      return;
    }
    
    if (!Number.isFinite(editingOrder.amount) || editingOrder.amount < 0) {
      setOrderFormError('请输入有效金额(>=0)');
      return;
    }

    setSubmitting(true);
    
    try {
      const result = await apiCall('invoice', {
        method: 'PUT',
        body: JSON.stringify({
          action: 'updateOrder',
          orderId: editingOrder.id,
          orderNo: editingOrder.orderNo,
          amount: editingOrder.amount,
          customerMark: editingOrder.customerMark,
          customerName: editingOrder.customerName || null,
          customerPhone: editingOrder.customerPhone || null,
          customerCity: editingOrder.customerCity || null,
          customerId: editingOrder.customerId || null,
        }),
      });

      if (result.success) {
        setShowOrderDialog(false);
        setEditingOrder(null);
        loadInvoices();
      } else {
        setOrderFormError(result.error || '修改失败');
      }
    } catch (err) {
      setOrderFormError('网络错误，请重试');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    if (!confirm('确定要删除这个订单吗？')) return;
    
    try {
      const result = await apiCall('invoice', {
        method: 'PUT',
        body: JSON.stringify({
          action: 'deleteOrder',
          orderId
        }),
      });

      if (result.success) {
        loadInvoices();
      } else {
        alert(result.error || '删除失败');
      }
    } catch (err) {
      alert('网络错误，请重试');
      console.error(err);
    }
  };

  const handleAddOrder = async () => {
    if (!addingOrderToInvoice) return;
    setAddError('');
    
    if (!newOrderNo.trim()) {
      setAddError('请输入客户单号');
      return;
    }
    
    if (!newOrderAmount || parseFloat(newOrderAmount) <= 0) {
      setAddError('请输入有效金额');
      return;
    }
    if (!newOrderCustomerMark.trim()) {
      setAddError('请输入客户MARK');
      return;
    }

    setSubmitting(true);
    
    try {
      const result = await apiCall('invoice', {
        method: 'PUT',
        body: JSON.stringify({
          action: 'addOrder',
          invoiceId: addingOrderToInvoice,
          orderNo: newOrderNo,
          amount: parseFloat(newOrderAmount),
          customerMark: newOrderCustomerMark,
          customerName: newOrderCustomerName || null,
          customerId: newOrderCustomerId || null,
        }),
      });

      if (result.success) {
        setAddingOrderToInvoice(null);
        setNewOrderNo('');
        setNewOrderAmount('');
        setNewOrderCustomerMark('');
        setNewOrderCustomerName('');
        setNewOrderCustomerId('');
        setNewOrderCustomerCandidates([]);
        loadInvoices();
      } else {
        setAddError(result.error || '添加失败');
      }
    } catch (err) {
      setAddError('网络错误，请重试');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  // 转移余额
  const handleTransferBalance = async () => {
    if (!transferFromOrder || !transferToOrderNo || !transferAmount) {
      setTransferError('请填写完整信息');
      return;
    }

    const amount = parseFloat(transferAmount);
    if (isNaN(amount) || amount <= 0) {
      setTransferError('请输入有效金额');
      return;
    }

    setSubmitting(true);
    setTransferError('');

    try {
      const result = await apiCall('invoice', {
        method: 'PUT',
        body: JSON.stringify({
          action: 'transferBalance',
          fromOrderId: transferFromOrder.id,
          toOrderNo: transferToOrderNo.trim(),
          transferAmount: amount
        })
      });

      if (result.success) {
        alert(result.message);
        setShowTransferDialog(false);
        setTransferFromOrder(null);
        setTransferToOrderNo('');
        setTransferAmount('');
        loadInvoices();
      } else {
        setTransferError(result.error || '转移失败');
      }
    } catch (err) {
      setTransferError('网络错误，请重试');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const addOrderRow = () => {
    setOrders([...orders, { orderNo: '', amount: '' }]);
  };

  const updateOrder = (index: number, field: 'orderNo' | 'amount', value: string) => {
    const newOrders = [...orders];
    newOrders[index][field] = value;
    setOrders(newOrders);
  };

  const removeOrder = (index: number) => {
    if (orders.length > 1) {
      setOrders(orders.filter((_, i) => i !== index));
    }
  };

  const isManager = user?.role === 'ADMIN' || user?.role === 'SALES';

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">账单管理</h2>
        <div className="flex gap-2">
          {isManager && (
            <>
              <Button 
                variant="outline" 
                onClick={handleRematch}
                disabled={refreshing}
              >
                {refreshing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                刷新匹配
              </Button>
              <Button onClick={() => setShowDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                直接创建账单
              </Button>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input
            placeholder="搜索 INV NO / ORDER"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div />
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setSearch('')}>
              重置筛选
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {invoices.map((invoice) => (
          <Card key={invoice.id}>
            <CardHeader 
              className="cursor-pointer hover:bg-gray-50"
              onClick={() => toggleInvoice(invoice.id)}
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-4">
                  {expandedInvoices.has(invoice.id) ? (
                    <ChevronDown className="h-5 w-5 text-gray-500" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-gray-500" />
                  )}
                  <div>
                    <CardTitle className="text-lg">{invoice.invNo}</CardTitle>
                    <CardDescription>
                      {invoice.orders.length} 个订单 | 创建于 {new Date(invoice.createdAt).toLocaleDateString()}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <div className="text-right">
                    <div className="text-gray-500">总金额</div>
                    <div className="font-semibold">${invoice.invAmount.toFixed(2)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-gray-500">未收金额</div>
                    <div className={`font-semibold ${invoice.invBalance > 0 ? 'text-red-500' : 'text-green-500'}`}>
                      ${invoice.invBalance.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            </CardHeader>
            
            {expandedInvoices.has(invoice.id) && (
              <CardContent className="border-t pt-4">
                <div className="flex justify-between items-center mb-4">
                  <h4 className="font-medium">订单明细</h4>
                  {isManager && (
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => setAddingOrderToInvoice(invoice.id)}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      添加订单
                    </Button>
                  )}
                </div>
                
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>客户单号 (ORDER)</TableHead>
                      <TableHead>MARK</TableHead>
                      <TableHead>金额 (AMOUNT)</TableHead>
                      <TableHead>未收金额</TableHead>
                      {isManager && <TableHead className="text-right">操作</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.orders.map((order) => {
                      return (
                        <TableRow key={order.id}>
                          <TableCell className="font-medium">
                            <button
                              type="button"
                              className={`underline ${order.needsCustomerFix ? 'text-red-600' : 'text-blue-600'}`}
                              onClick={() => openOrderHistory(order.id, order.orderNo)}
                            >
                              {order.orderNo}
                            </button>
                            {order.needsCustomerFix && (
                              <div className="text-xs text-red-500">please modify guest information</div>
                            )}
                          </TableCell>
                          <TableCell>
                            {order.customerMark || '-'}
                          </TableCell>
                          <TableCell>
                            ${order.amount.toFixed(2)}
                          </TableCell>
                          <TableCell className={order.orderBalance > 0 ? 'text-red-500' : 'text-green-500'}>
                            ${Math.abs(order.orderBalance).toFixed(2)}
                            {order.orderBalance < 0 && <span className="ml-1 text-xs">(多付)</span>}
                          </TableCell>
                          {isManager && (
                            <TableCell className="text-right">
                              {order.orderBalance < 0 && (
                                <Button 
                                  size="sm" 
                                  variant="ghost"
                                  onClick={() => {
                                    setTransferFromOrder({
                                      id: order.id,
                                      orderNo: order.orderNo,
                                      balance: order.orderBalance
                                    });
                                    setTransferAmount(Math.abs(order.orderBalance).toFixed(2));
                                    setShowTransferDialog(true);
                                  }}
                                  title="转移多付金额"
                                  className="text-blue-600 hover:text-blue-700"
                                >
                                  <ArrowRight className="h-4 w-4" />
                                </Button>
                              )}
                              <Button 
                                size="sm" 
                                variant="ghost"
                                onClick={() => {
                                  setEditingOrder({
                                    id: order.id,
                                    orderNo: order.orderNo,
                                    amount: order.amount,
                                    invoiceId: invoice.id,
                                    customerMark: order.customerMark || '',
                                    customerName: order.customerName || '',
                                    customerPhone: order.customerPhone || '',
                                    customerCity: order.customerCity || '',
                                    customerId: '',
                                  });
                                  setShowOrderDialog(true);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button 
                                size="sm" 
                                variant="ghost"
                                onClick={() => handleDeleteOrder(order.id)}
                              >
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                    {invoice.orders.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={isManager ? 5 : 4} className="text-center py-4 text-gray-500">
                          暂无订单
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                
                {/* 添加订单表单 */}
                {addingOrderToInvoice === invoice.id && (
                  <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                    <h5 className="font-medium mb-3">添加新订单</h5>
                    {addError && (
                      <Alert variant="destructive" className="mb-3">
                        <AlertDescription>{addError}</AlertDescription>
                      </Alert>
                    )}
                    <div className="flex gap-3">
                      <Input
                        placeholder="客户单号"
                        value={newOrderNo}
                        onChange={(e) => setNewOrderNo(e.target.value)}
                        className="flex-1"
                      />
                      <Input
                        placeholder="金额"
                        type="number"
                        value={newOrderAmount}
                        onChange={(e) => setNewOrderAmount(e.target.value)}
                        className="w-32"
                      />
                      <Input
                        placeholder="客户MARK(必填)"
                        value={newOrderCustomerMark}
                        onChange={(e) => {
                          const value = e.target.value;
                          setNewOrderCustomerMark(value);
                          setNewOrderCustomerId('');
                          setNewOrderCustomerName('');
                          loadCustomerCandidates(
                            value,
                            setNewOrderCustomerCandidates,
                            setNewOrderCustomerName,
                            setNewOrderCustomerId
                          );
                        }}
                        className="w-44"
                      />
                      {newOrderCustomerCandidates.length > 1 && (
                        <select
                          className="border rounded-md px-2 py-2 text-sm"
                          value={newOrderCustomerId}
                          onChange={(e) => {
                            const id = e.target.value;
                            setNewOrderCustomerId(id);
                            const selected = newOrderCustomerCandidates.find((c) => c.id === id);
                            setNewOrderCustomerName(selected?.name || '');
                          }}
                        >
                          <option value="">选择客户</option>
                          {newOrderCustomerCandidates.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>{candidate.mark}/{candidate.name}</option>
                          ))}
                        </select>
                      )}
                      <Button onClick={handleAddOrder} disabled={submitting}>
                        {submitting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                        添加
                      </Button>
                      <Button 
                        variant="outline" 
                        onClick={() => {
                          setAddingOrderToInvoice(null);
                          setNewOrderNo('');
                          setNewOrderAmount('');
                          setNewOrderCustomerMark('');
                          setNewOrderCustomerName('');
                          setNewOrderCustomerId('');
                          setNewOrderCustomerCandidates([]);
                          setAddError('');
                        }}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        ))}
        
        {invoices.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-gray-500">
              暂无账单
            </CardContent>
          </Card>
        )}
      </div>

      {/* 创建账单对话框 */}
      <Dialog open={showDialog} onOpenChange={(open) => { setShowDialog(open); if (!open) setFormError(''); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>创建账单</DialogTitle>
            <DialogDescription>创建新账单并添加订单</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label>账单号 (INV NO)</Label>
              <Input value={invNo} onChange={(e) => setInvNo(e.target.value)} placeholder="如: L25MH090125" />
            </div>
            <div className="space-y-2">
              <Label>客户MARK（必填）</Label>
              <Input
                value={customerMark}
                onChange={(e) => {
                  const value = e.target.value;
                  setCustomerMark(value);
                  setSelectedCustomerId('');
                  setCustomerName('');
                  loadCustomerCandidates(value, setCustomerCandidates, setCustomerName, setSelectedCustomerId);
                }}
                placeholder="输入客户MARK"
              />
              {customerCandidates.length > 1 && (
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm"
                  value={selectedCustomerId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedCustomerId(id);
                    const selected = customerCandidates.find((c) => c.id === id);
                    setCustomerName(selected?.name || '');
                  }}
                >
                  <option value="">请选择准确客户(MARK+NAME)</option>
                  {customerCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.mark} / {candidate.name}</option>
                  ))}
                </select>
              )}
              {customerName && <p className="text-xs text-gray-500">匹配客户：{customerName}</p>}
            </div>
            <div className="space-y-2">
              <Label>订单列表</Label>
              {orders.map((order, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    placeholder="客户单号 (ORDER)"
                    value={order.orderNo}
                    onChange={(e) => updateOrder(index, 'orderNo', e.target.value)}
                    className="flex-1"
                  />
                  <Input
                    placeholder="金额 (AMOUNT)"
                    type="number"
                    value={order.amount}
                    onChange={(e) => updateOrder(index, 'amount', e.target.value)}
                    className="w-32"
                  />
                  {orders.length > 1 && (
                    <Button variant="ghost" size="icon" onClick={() => removeOrder(index)}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button variant="outline" onClick={addOrderRow} className="w-full">
                <Plus className="h-4 w-4 mr-2" /> 添加订单
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={submitting}>取消</Button>
            <Button onClick={handleCreateInvoice} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑订单对话框 */}
      <Dialog open={showOrderDialog} onOpenChange={(open) => { setShowOrderDialog(open); if (!open) { setEditingOrder(null); setOrderFormError(''); }}}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑订单</DialogTitle>
            <DialogDescription>修改订单信息</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {orderFormError && (
              <Alert variant="destructive">
                <AlertDescription>{orderFormError}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label>客户单号 (ORDER)</Label>
              <Input 
                value={editingOrder?.orderNo || ''} 
                onChange={(e) => editingOrder && setEditingOrder({ ...editingOrder, orderNo: e.target.value })} 
              />
            </div>
            <div className="space-y-2">
              <Label>金额 (AMOUNT)</Label>
              <Input 
                type="number"
                value={editingOrder?.amount || ''} 
                onChange={(e) => editingOrder && setEditingOrder({ ...editingOrder, amount: parseFloat(e.target.value) || 0 })} 
              />
            </div>
            <div className="space-y-2">
              <Label>客户MARK</Label>
              <Input
                value={editingOrder?.customerMark || ''}
                onChange={(e) => editingOrder && setEditingOrder({ ...editingOrder, customerMark: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>客户NAME</Label>
              <Input
                value={editingOrder?.customerName || ''}
                onChange={(e) => editingOrder && setEditingOrder({ ...editingOrder, customerName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>客户PHONE</Label>
              <Input
                value={editingOrder?.customerPhone || ''}
                onChange={(e) => editingOrder && setEditingOrder({ ...editingOrder, customerPhone: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>客户CITY</Label>
              <Input
                value={editingOrder?.customerCity || ''}
                onChange={(e) => editingOrder && setEditingOrder({ ...editingOrder, customerCity: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowOrderDialog(false)} disabled={submitting}>取消</Button>
            <Button onClick={handleUpdateOrder} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 转移余额对话框 */}
      <Dialog open={showTransferDialog} onOpenChange={(open) => { setShowTransferDialog(open); if (!open) { setTransferFromOrder(null); setTransferToOrderNo(''); setTransferAmount(''); setTransferError(''); }}}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>转移多付余额</DialogTitle>
            <DialogDescription>
              将订单 <strong>{transferFromOrder?.orderNo}</strong> 的多付金额转移到其他订单
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {transferError && (
              <Alert variant="destructive">
                <AlertDescription>{transferError}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label>当前多付金额</Label>
              <div className="text-green-600 font-bold text-lg">
                ${Math.abs(transferFromOrder?.balance || 0).toFixed(2)}
              </div>
            </div>
            <div className="space-y-2">
              <Label>目标订单号</Label>
              <Input 
                placeholder="输入目标订单号"
                value={transferToOrderNo} 
                onChange={(e) => setTransferToOrderNo(e.target.value)} 
              />
              <p className="text-xs text-gray-500">如果订单不存在，将创建到 Un_Associated 账单</p>
            </div>
            <div className="space-y-2">
              <Label>转移金额</Label>
              <Input 
                type="number"
                step="0.01"
                value={transferAmount} 
                onChange={(e) => setTransferAmount(e.target.value)} 
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTransferDialog(false)} disabled={submitting}>取消</Button>
            <Button onClick={handleTransferBalance} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              确认转移
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={orderHistoryOpen} onOpenChange={setOrderHistoryOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>ORDER 付款记录</DialogTitle>
            <DialogDescription>{orderHistoryTitle}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>收据号</TableHead>
                  <TableHead>金额</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>日期</TableHead>
                  <TableHead>创建时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderHistoryRows.map((row) => (
                  <TableRow key={String(row.id)}>
                    <TableCell>{(row.receiptNo as string) || '-'}</TableCell>
                    <TableCell>${Number(row.usd || 0).toFixed(2)}</TableCell>
                    <TableCell><Badge>{String(row.status || '-')}</Badge></TableCell>
                    <TableCell>{row.date ? new Date(String(row.date)).toLocaleDateString() : '-'}</TableCell>
                    <TableCell>{row.createdAt ? new Date(String(row.createdAt)).toLocaleString() : '-'}</TableCell>
                  </TableRow>
                ))}
                {orderHistoryRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-gray-500">暂无付款记录</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// 收据管理
function ReceiptManager() {
  const { receipts, setReceipts, loading, setLoading, user } = useStore();
  const [showUpload, setShowUpload] = useState(false);
  const [showDirectCreate, setShowDirectCreate] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ocrResult, setOcrResult] = useState<Record<string, unknown> | null>(null);
  const [ocrCustomerMark, setOcrCustomerMark] = useState('');
  const [ocrCustomerName, setOcrCustomerName] = useState('');
  const [ocrCustomerId, setOcrCustomerId] = useState('');
  const [ocrCustomerCandidates, setOcrCustomerCandidates] = useState<Array<{ id: string; mark: string; name: string }>>([]);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [directForm, setDirectForm] = useState({
    receiptNo: '',
    date: '',
    tel: '',
    usd: '',
    invNo: '',
    orderNo: '',
    payer: '',
    customerMark: '',
    customerName: '',
    customerId: '',
    isDeposit: false,
  });
  const [directCustomerCandidates, setDirectCustomerCandidates] = useState<Array<{ id: string; mark: string; name: string }>>([]);
  
  // 图片查看对话框
  const [viewingImage, setViewingImage] = useState<{ url: string; name: string } | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minUsd, setMinUsd] = useState('');
  const [maxUsd, setMaxUsd] = useState('');
  
  // 分页
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 30;
  const totalPages = Math.ceil(receipts.length / pageSize);
  const paginatedReceipts = receipts.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const loadReceipts = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (statusFilter) params.set('status', statusFilter);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (minUsd) params.set('minUsd', minUsd);
    if (maxUsd) params.set('maxUsd', maxUsd);
    const query = params.toString();
    const result = await apiCall(`receipt${query ? `?${query}` : ''}`);
    if (result.success) {
      setReceipts(result.data);
    }
    setLoading(false);
  }, [setReceipts, setLoading, search, statusFilter, dateFrom, dateTo, minUsd, maxUsd]);

  useEffect(() => {
    loadReceipts();
  }, [loadReceipts]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter, dateFrom, dateTo, minUsd, maxUsd]);

  useEffect(() => {
    if (!showDirectCreate) return;
    const currentOrderNo = directForm.orderNo;
    if (!currentOrderNo.trim()) return;
    const timer = setTimeout(() => {
      void lookupCustomerByOrderNoGroup(currentOrderNo).then((matched) => {
        if (!matched) return;
        setDirectForm((prev) => ({
          ...prev,
          customerMark: matched.mark,
          customerName: matched.name || prev.customerName,
          customerId: matched.customerId || prev.customerId,
        }));
        loadCustomerCandidates(
          matched.mark,
          (rows) => setDirectCustomerCandidates(rows),
          (resolvedName) => setDirectForm((prev) => ({ ...prev, customerName: resolvedName })),
          (resolvedId) => setDirectForm((prev) => ({ ...prev, customerId: resolvedId }))
        );
      });
    }, 260);
    return () => clearTimeout(timer);
  }, [directForm.orderNo, showDirectCreate]);

  useEffect(() => {
    if (!showUpload || !ocrResult) return;
    const currentOrderNo = typeof ocrResult.orderNo === 'string' ? ocrResult.orderNo : '';
    if (!currentOrderNo.trim()) return;
    const timer = setTimeout(() => {
      void lookupCustomerByOrderNoGroup(currentOrderNo).then((matched) => {
        if (!matched) return;
        setOcrCustomerMark(matched.mark);
        setOcrCustomerName(matched.name);
        setOcrCustomerId(matched.customerId);
        loadCustomerCandidates(matched.mark, setOcrCustomerCandidates, setOcrCustomerName, setOcrCustomerId);
      });
    }, 260);
    return () => clearTimeout(timer);
  }, [ocrResult, showUpload]);

  const loadCustomerCandidates = async (
    mark: string,
    setter: (rows: Array<{ id: string; mark: string; name: string }>) => void,
    setDefaultName?: (value: string) => void,
    setDefaultId?: (value: string) => void
  ) => {
    const normalized = mark.trim();
    if (!normalized) {
      setter([]);
      if (setDefaultName) setDefaultName('');
      if (setDefaultId) setDefaultId('');
      return;
    }
    try {
      const result = await apiCall(`customer?mark=${encodeURIComponent(normalized)}`);
      if (!result.success || !Array.isArray(result.data)) {
        setter([]);
        return;
      }
      const rows = result.data.map((row: { id: string; mark: string; name: string }) => ({
        id: row.id,
        mark: row.mark,
        name: row.name,
      }));
      setter(rows);
      if (rows.length === 1) {
        if (setDefaultName) setDefaultName(rows[0].name);
        if (setDefaultId) setDefaultId(rows[0].id);
      }
    } catch {
      setter([]);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setUploading(true);
    setError(null);

    // 预览
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);

    // AI识别
    const formData = new FormData();
    formData.append('file', file);
    formData.append('action', 'recognize');

    try {
      const result = await fetch('/api/receipt', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }).then(r => r.json());

      if (result.success) {
        setOcrResult(result.data.ocrResult);
        setOcrCustomerMark('');
        setOcrCustomerName('');
        setOcrCustomerId('');
        setOcrCustomerCandidates([]);
      } else {
        setError(result.error || 'AI识别失败，请重试');
      }
    } catch (err) {
      console.error('OCR error:', err);
      setError('网络错误，请重试');
    }
    setUploading(false);
  };

  const handleConfirm = async () => {
    if (!selectedFile || !ocrResult) return;
    if (!ocrCustomerMark.trim()) {
      setError('客户MARK不能为空');
      return;
    }

    setError(null);
    setSubmitting(true);
    const formData = new FormData();
    const payload = {
      ...ocrResult,
      customerMark: ocrCustomerMark.trim(),
      customerName: ocrCustomerName || null,
      customerId: ocrCustomerId || null,
    };
    formData.append('action', 'confirm');
    formData.append('data', JSON.stringify(payload));
    formData.append('imagePath', imagePreview || '');
    formData.append('imageName', selectedFile.name);

    try {
      const result = await fetch('/api/receipt', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }).then(r => r.json());

      if (result.success) {
        setShowUpload(false);
        setOcrResult(null);
        setOcrCustomerMark('');
        setOcrCustomerName('');
        setOcrCustomerId('');
        setOcrCustomerCandidates([]);
        setImagePreview(null);
        setSelectedFile(null);
        loadReceipts();
      } else {
        setError(result.error || '创建失败，请重试');
      }
    } catch (err) {
      console.error('Confirm error:', err);
      setError('网络错误，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMarkReceived = async (receiptId: string) => {
    if (!confirm('确定要标记此收据为已签收吗？')) return;
    
    try {
      const result = await fetch('/api/receipt', {
        method: 'POST',
        credentials: 'include',
        headers: { 
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'mark-received', receiptId }),
      }).then(r => r.json());

      if (result.success) {
        loadReceipts();
      } else {
        alert(result.error || '操作失败');
      }
    } catch (err) {
      alert('网络错误，请重试');
      console.error(err);
    }
  };

  const handleDirectCreate = async () => {
    setError(null);
    if (!directForm.customerMark.trim()) {
      setError('客户MARK不能为空');
      return;
    }
    try {
      const result = await apiCall('receipt', {
        method: 'POST',
        body: JSON.stringify({
          action: 'direct-create',
          receiptNo: directForm.receiptNo || null,
          date: directForm.date || null,
          tel: directForm.tel || null,
          usd: Number(directForm.usd),
          invNo: directForm.invNo || null,
          orderNo: directForm.orderNo || null,
          payer: directForm.payer || null,
          customerMark: directForm.customerMark || null,
          customerName: directForm.customerName || null,
          customerId: directForm.customerId || null,
          isDeposit: directForm.isDeposit,
        }),
      });
      if (result.success) {
        setShowDirectCreate(false);
        setDirectForm({
          receiptNo: '',
          date: '',
          tel: '',
          usd: '',
          invNo: '',
          orderNo: '',
          payer: '',
          customerMark: '',
          customerName: '',
          customerId: '',
          isDeposit: false,
        });
        setDirectCustomerCandidates([]);
        loadReceipts();
      } else {
        setError(result.error || '创建失败，请重试');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败，请重试');
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      'SR_Received': 'secondary',
      'Waiting_SWIFT': 'outline',
      'Bank_Transfer': 'default',
      'RECEIVED': 'default'
    };
    return <Badge variant={colors[status] || 'default'}>{status}</Badge>;
  };

  const handleDeleteReceipt = async (receiptId: string) => {
    if (!confirm('确定要申请删除这条收据吗？删除需要管理员审批。')) return;
    
    const result = await apiCall('deletion', {
      method: 'POST',
      body: JSON.stringify({ 
        action: 'request', 
        targetType: 'RECEIPT', 
        targetId: receiptId 
      }),
    });

    if (result.success) {
      alert('删除申请已提交，等待管理员审批');
      loadReceipts();
    } else {
      alert(result.error || '申请失败');
    }
  };

  const isManager = user?.role === 'ADMIN' || user?.role === 'SALES';

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">收据管理</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowDirectCreate(true)}>
            <Plus className="h-4 w-4 mr-2" />
            直接创建
          </Button>
          <Button onClick={() => setShowUpload(true)}>
            <Upload className="h-4 w-4 mr-2" />
            上传收据
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Input placeholder="搜索收据号/单号/付款人" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="border rounded-md px-3 py-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">全部状态</option>
            <option value="SR_Received">SR_Received</option>
            <option value="Waiting_SWIFT">Waiting_SWIFT</option>
            <option value="Bank_Transfer">Bank_Transfer</option>
            <option value="RECEIVED">RECEIVED</option>
          </select>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <Input type="number" placeholder="最小金额" value={minUsd} onChange={(e) => setMinUsd(e.target.value)} />
          <Input type="number" placeholder="最大金额" value={maxUsd} onChange={(e) => setMaxUsd(e.target.value)} />
          <div className="md:col-span-3 lg:col-span-6 flex justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setSearch('');
                setStatusFilter('');
                setDateFrom('');
                setDateTo('');
                setMinUsd('');
                setMaxUsd('');
              }}
            >
              重置筛选
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>收据号</TableHead>
                <TableHead>客户单号</TableHead>
                <TableHead>MARK</TableHead>
                <TableHead>付款金额</TableHead>
                <TableHead>付款人</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedReceipts.map((receipt) => (
                <TableRow key={receipt.id} className={receipt.needsCustomerFix ? 'bg-red-50' : ''}>
                  <TableCell>{receipt.receiptNo || '-'}</TableCell>
                  <TableCell>
                    {receipt.orderNo || '-'}
                    {receipt.needsCustomerFix && <div className="text-xs text-red-500">please modify guest information</div>}
                  </TableCell>
                  <TableCell>{receipt.customerMark || '-'}</TableCell>
                  <TableCell className="font-medium">${receipt.usd.toFixed(2)}</TableCell>
                  <TableCell>{receipt.payer || '-'}</TableCell>
                  <TableCell>{getStatusBadge(receipt.status)}</TableCell>
                  <TableCell>{new Date(receipt.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {receipt.imageUrl && (
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          onClick={() => setViewingImage({ url: receipt.imageUrl!, name: receipt.imageName || '收据图片' })}
                          title="查看图片"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      )}
                      {receipt.status === 'Bank_Transfer' && isManager && (
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          onClick={() => handleMarkReceived(receipt.id)}
                          title="签收归档"
                          className="text-green-600 hover:text-green-700"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      )}
                      {receipt.status !== 'RECEIVED' && receipt.status !== 'Bank_Transfer' && (
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          onClick={() => handleDeleteReceipt(receipt.id)}
                          title="申请删除"
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {receipts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                    暂无收据
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          
          {/* 分页控件 */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-2 py-4 border-t">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                上一页
              </Button>
              <span className="text-sm text-gray-600">
                第 {currentPage} / {totalPages} 页 (共 {receipts.length} 条)
              </span>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                下一页
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 上传对话框 */}
      <Dialog open={showUpload} onOpenChange={(open) => { setShowUpload(open); if (!open) { setError(null); setOcrResult(null); setImagePreview(null); setOcrCustomerMark(''); setOcrCustomerName(''); setOcrCustomerId(''); setOcrCustomerCandidates([]); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>上传收据</DialogTitle>
            <DialogDescription>上传收据图片，AI将自动识别内容</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="border-2 border-dashed rounded-lg p-4">
              <Input type="file" accept="image/*" onChange={handleFileSelect} />
            </div>

            {uploading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="ml-2">AI识别中...</span>
              </div>
            )}

            {imagePreview && (
              <div className="border rounded-lg p-2">
                <img src={imagePreview} alt="Preview" className="max-h-48 mx-auto rounded" />
              </div>
            )}

            {ocrResult && (
              <div className="space-y-3 border rounded-lg p-4">
                <h4 className="font-medium">识别结果</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-sm text-gray-500">收据号</Label>
                    <Input 
                      value={(ocrResult.receiptNo as string) || ''} 
                      onChange={(e) => setOcrResult({...ocrResult, receiptNo: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label className="text-sm text-gray-500">日期</Label>
                    <Input 
                      value={(ocrResult.date as string) || ''} 
                      onChange={(e) => setOcrResult({...ocrResult, date: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label className="text-sm text-gray-500">付款金额 (USD)</Label>
                    <Input 
                      type="number"
                      value={(ocrResult.usd as number) || ''} 
                      onChange={(e) => setOcrResult({...ocrResult, usd: parseFloat(e.target.value)})}
                    />
                  </div>
                  <div>
                    <Label className="text-sm text-gray-500">客户单号</Label>
                    <Input 
                      value={(ocrResult.orderNo as string) || ''} 
                      onChange={(e) => setOcrResult({...ocrResult, orderNo: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label className="text-sm text-gray-500">账单号</Label>
                    <Input 
                      value={(ocrResult.invNo as string) || ''} 
                      onChange={(e) => setOcrResult({...ocrResult, invNo: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label className="text-sm text-gray-500">付款人</Label>
                    <Input 
                      value={(ocrResult.payer as string) || ''} 
                      onChange={(e) => setOcrResult({...ocrResult, payer: e.target.value})}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-sm text-gray-500">客户MARK（必填）</Label>
                    <Input
                      value={ocrCustomerMark}
                      onChange={(e) => {
                        const value = e.target.value;
                        setOcrCustomerMark(value);
                        setOcrCustomerName('');
                        setOcrCustomerId('');
                        loadCustomerCandidates(value, setOcrCustomerCandidates, setOcrCustomerName, setOcrCustomerId);
                      }}
                    />
                  </div>
                  {ocrCustomerCandidates.length > 1 && (
                    <div className="col-span-2">
                      <Label className="text-sm text-gray-500">选择准确客户(MARK+NAME)</Label>
                      <select
                        className="w-full border rounded-md px-3 py-2 text-sm"
                        value={ocrCustomerId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setOcrCustomerId(id);
                          const selected = ocrCustomerCandidates.find((c) => c.id === id);
                          setOcrCustomerName(selected?.name || '');
                        }}
                      >
                        <option value="">请选择</option>
                        {ocrCustomerCandidates.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>{candidate.mark} / {candidate.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="col-span-2">
                    <Label className="flex items-center gap-2">
                      <input 
                        type="checkbox" 
                        checked={ocrResult.isDeposit as boolean} 
                        onChange={(e) => setOcrResult({...ocrResult, isDeposit: e.target.checked})}
                      />
                      这是定金 (DEPOSIT)
                    </Label>
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowUpload(false);
              setOcrResult(null);
              setImagePreview(null);
            }} disabled={submitting}>取消</Button>
            <Button onClick={handleConfirm} disabled={!ocrResult || submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  处理中...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" /> 确认创建
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDirectCreate} onOpenChange={(open) => { setShowDirectCreate(open); if (!open) { setError(null); setDirectCustomerCandidates([]); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>直接创建收据</DialogTitle>
            <DialogDescription>跳过AI识别，手动录入收据信息</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input placeholder="收据号" value={directForm.receiptNo} onChange={(e) => setDirectForm((p) => ({ ...p, receiptNo: e.target.value }))} />
            <Input type="date" placeholder="日期" value={directForm.date} onChange={(e) => setDirectForm((p) => ({ ...p, date: e.target.value }))} />
            <Input placeholder="电话" value={directForm.tel} onChange={(e) => setDirectForm((p) => ({ ...p, tel: e.target.value }))} />
            <Input type="number" placeholder="付款金额(USD)" value={directForm.usd} onChange={(e) => setDirectForm((p) => ({ ...p, usd: e.target.value }))} />
            <Input placeholder="账单号(invNo)" value={directForm.invNo} onChange={(e) => setDirectForm((p) => ({ ...p, invNo: e.target.value }))} />
            <Input placeholder="客户单号(orderNo)" value={directForm.orderNo} onChange={(e) => setDirectForm((p) => ({ ...p, orderNo: e.target.value }))} />
            <Input placeholder="付款人" value={directForm.payer} onChange={(e) => setDirectForm((p) => ({ ...p, payer: e.target.value }))} />
            <Input
              placeholder="客户MARK(必填)"
              value={directForm.customerMark}
              onChange={(e) => {
                const value = e.target.value;
                setDirectForm((p) => ({ ...p, customerMark: value, customerName: '', customerId: '' }));
                loadCustomerCandidates(
                  value,
                  (rows) => setDirectCustomerCandidates(rows),
                  (name) => setDirectForm((p) => ({ ...p, customerName: name })),
                  (id) => setDirectForm((p) => ({ ...p, customerId: id }))
                );
              }}
            />
            {directCustomerCandidates.length > 1 && (
              <select
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={directForm.customerId}
                onChange={(e) => {
                  const id = e.target.value;
                  const selected = directCustomerCandidates.find((c) => c.id === id);
                  setDirectForm((p) => ({ ...p, customerId: id, customerName: selected?.name || '' }));
                }}
              >
                <option value="">请选择准确客户(MARK+NAME)</option>
                {directCustomerCandidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>{candidate.mark} / {candidate.name}</option>
                ))}
              </select>
            )}
            <Label className="flex items-center gap-2">
              <input type="checkbox" checked={directForm.isDeposit} onChange={(e) => setDirectForm((p) => ({ ...p, isDeposit: e.target.checked }))} />
              定金
            </Label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDirectCreate(false)}>取消</Button>
            <Button onClick={handleDirectCreate}>
              <Check className="h-4 w-4 mr-2" />
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 图片查看对话框 */}
      <Dialog open={!!viewingImage} onOpenChange={(open) => { if (!open) setViewingImage(null); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{viewingImage?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex justify-center">
            {viewingImage && (
              <img 
                src={viewingImage.url} 
                alt={viewingImage.name} 
                className="max-h-[70vh] object-contain rounded-lg"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// 付款明细管理
function DetailManager() {
  const { details, setDetails } = useStore();
  const [showUpload, setShowUpload] = useState(false);
  const [showDirectCreate, setShowDirectCreate] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ocrResult, setOcrResult] = useState<{ date: string | null; items: { mark: string | null; orderNo: string | null; amount: number; matchedReceiptId?: string | null }[] } | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 服务器保存的图片路径
  const [savedImagePath, setSavedImagePath] = useState<{ path: string; name: string } | null>(null);
  const [directDate, setDirectDate] = useState('');
  const [directItems, setDirectItems] = useState([{ mark: '', orderNo: '', amount: '' }]);
  
  // 折叠状态
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(new Set());
  
  // 图片查看对话框
  const [viewingImage, setViewingImage] = useState<{ url: string; name: string } | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');

  const loadDetails = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (statusFilter) params.set('status', statusFilter);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (minAmount) params.set('minAmount', minAmount);
    if (maxAmount) params.set('maxAmount', maxAmount);
    const query = params.toString();
    const result = await apiCall(`detail${query ? `?${query}` : ''}`);
    if (result.success) {
      setDetails(result.data);
    }
  }, [setDetails, search, statusFilter, dateFrom, dateTo, minAmount, maxAmount]);

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  const toggleDetail = (detailId: string) => {
    const newExpanded = new Set(expandedDetails);
    if (newExpanded.has(detailId)) {
      newExpanded.delete(detailId);
    } else {
      newExpanded.add(detailId);
    }
    setExpandedDetails(newExpanded);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setUploading(true);
    setError(null);

    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('action', 'recognize');

    try {
      const result = await fetch('/api/detail', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }).then(r => r.json());

      if (result.success) {
        setOcrResult(result.data.ocrResult);
        // 保存服务器返回的图片路径
        console.log('[Detail Recognize] result.data.image:', result.data.image);
        if (result.data.image) {
          setSavedImagePath(result.data.image);
        }
      } else {
        setError(result.error || 'AI识别失败，请重试');
      }
    } catch (err) {
      console.error('OCR error:', err);
      setError('网络错误，请重试');
    }
    setUploading(false);
  };

  const handleConfirm = async () => {
    if (!selectedFile || !ocrResult) return;

    setError(null);
    setSubmitting(true);
    const formData = new FormData();
    formData.append('action', 'confirm');
    formData.append('data', JSON.stringify(ocrResult));
    // 使用服务器保存的图片路径
    console.log('[Detail Confirm] savedImagePath:', savedImagePath);
    formData.append('imagePath', savedImagePath?.path || '');
    formData.append('imageName', savedImagePath?.name || selectedFile.name);

    try {
      const result = await fetch('/api/detail', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }).then(r => r.json());

      if (result.success) {
        setShowUpload(false);
        setOcrResult(null);
        setImagePreview(null);
        setSelectedFile(null);
        setSavedImagePath(null);
        loadDetails();
      } else {
        setError(result.error || '创建失败，请重试');
      }
    } catch (err) {
      console.error('Confirm error:', err);
      setError('网络错误，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteDetail = async (detailId: string) => {
    if (!confirm('确定要申请删除这条付款明细吗？删除需要管理员审批。')) return;
    
    const result = await apiCall('deletion', {
      method: 'POST',
      body: JSON.stringify({ 
        action: 'request', 
        targetType: 'DETAIL', 
        targetId: detailId 
      }),
    });

    if (result.success) {
      alert('删除申请已提交，等待管理员审批');
      loadDetails();
    } else {
      alert(result.error || '申请失败');
    }
  };

  const handleDirectCreate = async () => {
    setError(null);
    try {
      const payloadItems = directItems
        .filter((item) => item.amount && Number(item.amount) > 0)
        .map((item) => ({
          mark: item.mark || null,
          orderNo: item.orderNo || null,
          amount: Number(item.amount),
        }));

      const result = await apiCall('detail', {
        method: 'POST',
        body: JSON.stringify({
          action: 'direct-create',
          date: directDate || null,
          items: payloadItems,
        }),
      });

      if (result.success) {
        setShowDirectCreate(false);
        setDirectDate('');
        setDirectItems([{ mark: '', orderNo: '', amount: '' }]);
        loadDetails();
      } else {
        setError(result.error || '创建失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">付款明细管理</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowDirectCreate(true)}>
            <Plus className="h-4 w-4 mr-2" />
            直接创建
          </Button>
          <Button onClick={() => setShowUpload(true)}>
            <Upload className="h-4 w-4 mr-2" />
            上传付款明细
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Input placeholder="搜索唛头/单号" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="border rounded-md px-3 py-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">全部状态</option>
            <option value="Waiting_SWIFT">Waiting_SWIFT</option>
            <option value="Bank_Transfer">Bank_Transfer</option>
            <option value="RECEIVED">RECEIVED</option>
            <option value="ERROR">ERROR</option>
          </select>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <Input type="number" placeholder="最小总金额" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
          <Input type="number" placeholder="最大总金额" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} />
          <div className="md:col-span-3 lg:col-span-6 flex justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setSearch('');
                setStatusFilter('');
                setDateFrom('');
                setDateTo('');
                setMinAmount('');
                setMaxAmount('');
              }}
            >
              重置筛选
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {details.map((detail) => (
          <Card key={detail.id} className={detail.status === 'ERROR' ? 'border-red-500' : ''}>
            <CardHeader 
              className="cursor-pointer hover:bg-gray-50"
              onClick={() => toggleDetail(detail.id)}
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-4">
                  {expandedDetails.has(detail.id) ? (
                    <ChevronDown className="h-5 w-5 text-gray-500" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-gray-500" />
                  )}
                  <div>
                    <CardTitle className="text-lg">
                      付款明细 - {detail.date ? new Date(detail.date).toLocaleDateString() : '日期未知'}
                    </CardTitle>
                    <CardDescription>
                      {detail.items.length} 笔 | 总计: ${detail.totalAmount.toFixed(2)}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={detail.status === 'ERROR' ? 'destructive' : 'default'}>
                    {detail.status}
                  </Badge>
                  {detail.imageUrl && (
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        setViewingImage({ url: detail.imageUrl!, name: detail.imageName || '付款明细图片' }); 
                      }}
                      title="查看图片"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  )}
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    onClick={(e) => { e.stopPropagation(); handleDeleteDetail(detail.id); }}
                    title="申请删除"
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            
            {expandedDetails.has(detail.id) && (
              <CardContent className="border-t pt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>唛头</TableHead>
                      <TableHead>单号</TableHead>
                      <TableHead>金额</TableHead>
                      <TableHead>关联收据</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.mark || '-'}</TableCell>
                        <TableCell>{item.orderNo || '-'}</TableCell>
                        <TableCell>${item.amount.toFixed(2)}</TableCell>
                        <TableCell>
                          {item.receipt ? (
                            <Badge variant="outline">{item.receipt.orderNo}</Badge>
                          ) : (
                            <span className="text-gray-400">未匹配</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            )}
          </Card>
        ))}
        {details.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-gray-500">
              暂无付款明细
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={showUpload} onOpenChange={(open) => { setShowUpload(open); if (!open) { setError(null); setOcrResult(null); setImagePreview(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>上传付款明细</DialogTitle>
            <DialogDescription>上传付款明细图片，AI将自动识别内容</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="border-2 border-dashed rounded-lg p-4">
              <Input type="file" accept="image/*" onChange={handleFileSelect} />
            </div>

            {uploading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="ml-2">AI识别中...</span>
              </div>
            )}

            {imagePreview && (
              <div className="border rounded-lg p-2">
                <img src={imagePreview} alt="Preview" className="max-h-48 mx-auto rounded" />
              </div>
            )}

            {ocrResult && (
              <div className="space-y-3 border rounded-lg p-4">
                <h4 className="font-medium">识别结果</h4>
                <div>
                  <Label className="text-sm text-gray-500">日期</Label>
                  <Input 
                    value={ocrResult.date || ''} 
                    onChange={(e) => setOcrResult({...ocrResult, date: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm text-gray-500">明细项目</Label>
                  {ocrResult.items.map((item, index) => (
                    <div key={index} className="grid grid-cols-3 gap-2">
                      <Input 
                        placeholder="唛头"
                        value={item.mark || ''} 
                        onChange={(e) => {
                          const newItems = [...ocrResult.items];
                          newItems[index] = {...item, mark: e.target.value};
                          setOcrResult({...ocrResult, items: newItems});
                        }}
                      />
                      <Input 
                        placeholder="单号"
                        value={item.orderNo || ''} 
                        onChange={(e) => {
                          const newItems = [...ocrResult.items];
                          newItems[index] = {...item, orderNo: e.target.value};
                          setOcrResult({...ocrResult, items: newItems});
                        }}
                      />
                      <Input 
                        placeholder="金额"
                        type="number"
                        value={item.amount || ''} 
                        onChange={(e) => {
                          const newItems = [...ocrResult.items];
                          newItems[index] = {...item, amount: parseFloat(e.target.value)};
                          setOcrResult({...ocrResult, items: newItems});
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowUpload(false);
              setOcrResult(null);
              setImagePreview(null);
            }} disabled={submitting}>取消</Button>
            <Button onClick={handleConfirm} disabled={!ocrResult || submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  处理中...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" /> 确认创建
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDirectCreate} onOpenChange={setShowDirectCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>直接创建付款明细</DialogTitle>
            <DialogDescription>跳过AI识别，手动录入明细行</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input type="date" value={directDate} onChange={(e) => setDirectDate(e.target.value)} />
            {directItems.map((item, idx) => (
              <div key={idx} className="grid grid-cols-3 gap-2">
                <Input
                  placeholder="唛头"
                  value={item.mark}
                  onChange={(e) => setDirectItems((prev) => prev.map((row, i) => (i === idx ? { ...row, mark: e.target.value } : row)))}
                />
                <Input
                  placeholder="单号"
                  value={item.orderNo}
                  onChange={(e) => setDirectItems((prev) => prev.map((row, i) => (i === idx ? { ...row, orderNo: e.target.value } : row)))}
                />
                <Input
                  type="number"
                  placeholder="金额"
                  value={item.amount}
                  onChange={(e) => setDirectItems((prev) => prev.map((row, i) => (i === idx ? { ...row, amount: e.target.value } : row)))}
                />
              </div>
            ))}
            <Button variant="outline" onClick={() => setDirectItems((prev) => [...prev, { mark: '', orderNo: '', amount: '' }])}>
              <Plus className="h-4 w-4 mr-2" />
              增加明细行
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDirectCreate(false)}>取消</Button>
            <Button onClick={handleDirectCreate}>
              <Check className="h-4 w-4 mr-2" />
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 图片查看对话框 */}
      <Dialog open={!!viewingImage} onOpenChange={(open) => { if (!open) setViewingImage(null); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{viewingImage?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex justify-center">
            {viewingImage && (
              <img 
                src={viewingImage.url} 
                alt={viewingImage.name} 
                className="max-h-[70vh] object-contain rounded-lg"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// SWIFT管理
function SwiftManager() {
  const { swifts, setSwifts, details } = useStore();
  const [showUpload, setShowUpload] = useState(false);
  const [showDirectCreate, setShowDirectCreate] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ocrResult, setOcrResult] = useState<Record<string, unknown> | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedDetailId, setSelectedDetailId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [hasErrorFilter, setHasErrorFilter] = useState('');
  const [directForm, setDirectForm] = useState({
    detailId: '',
    amount: '',
    date: '',
    senderName: '',
    senderAddress: '',
    receiverName: '',
    receiverAccount: '',
  });

  const loadSwifts = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (minAmount) params.set('minAmount', minAmount);
    if (maxAmount) params.set('maxAmount', maxAmount);
    if (hasErrorFilter) params.set('hasError', hasErrorFilter);
    const query = params.toString();
    const result = await apiCall(`swift${query ? `?${query}` : ''}`);
    if (result.success) {
      setSwifts(result.data);
    }
  }, [setSwifts, search, dateFrom, dateTo, minAmount, maxAmount, hasErrorFilter]);

  useEffect(() => {
    loadSwifts();
  }, [loadSwifts]);

  const waitingDetails = details.filter(d => d.status === 'Waiting_SWIFT');
  const getSwiftStatus = (swift: { status?: string; detailId: string }) => {
    if (swift.status) return swift.status;
    const detail = details.find((d) => d.id === swift.detailId);
    if (!detail) return 'Bank_Transfer';
    if (detail.status === 'RECEIVED') return 'RECEIVED';
    if (detail.status === 'ERROR') return 'ERROR';
    return 'Bank_Transfer';
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setUploading(true);
    setError(null);

    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('action', 'recognize');

    try {
      const result = await fetch('/api/swift', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }).then(r => r.json());

      if (result.success) {
        setOcrResult(result.data.ocrResult);
      } else {
        setError(result.error || 'AI识别失败，请重试');
      }
    } catch (err) {
      console.error('OCR error:', err);
      setError('网络错误，请重试');
    }
    setUploading(false);
  };

  const handleConfirm = async () => {
    if (!selectedFile || !ocrResult || !selectedDetailId) {
      setError('请选择付款明细');
      return;
    }

    setError(null);
    setSubmitting(true);
    const formData = new FormData();
    formData.append('action', 'confirm');
    formData.append('detailId', selectedDetailId);
    formData.append('data', JSON.stringify(ocrResult));
    formData.append('imagePath', imagePreview || '');
    formData.append('imageName', selectedFile.name);

    try {
      const result = await fetch('/api/swift', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }).then(r => r.json());

      if (result.success) {
        setShowUpload(false);
        setOcrResult(null);
        setImagePreview(null);
        setSelectedFile(null);
        setSelectedDetailId('');
        loadSwifts();
      } else {
        setError(result.error || '创建失败，请重试');
      }
    } catch (err) {
      console.error('Confirm error:', err);
      setError('网络错误，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteSwift = async (swiftId: string) => {
    if (!confirm('确定要申请删除这条SWIFT水单吗？删除需要管理员审批。')) return;
    
    const result = await apiCall('deletion', {
      method: 'POST',
      body: JSON.stringify({ 
        action: 'request', 
        targetType: 'SWIFT', 
        targetId: swiftId 
      }),
    });

    if (result.success) {
      alert('删除申请已提交，等待管理员审批');
      loadSwifts();
    } else {
      alert(result.error || '申请失败');
    }
  };

  const handleDirectCreate = async () => {
    setError(null);
    try {
      const result = await apiCall('swift', {
        method: 'POST',
        body: JSON.stringify({
          action: 'direct-create',
          detailId: directForm.detailId,
          amount: Number(directForm.amount),
          date: directForm.date || null,
          senderName: directForm.senderName || null,
          senderAddress: directForm.senderAddress || null,
          receiverName: directForm.receiverName || null,
          receiverAccount: directForm.receiverAccount || null,
        }),
      });
      if (result.success) {
        setShowDirectCreate(false);
        setDirectForm({
          detailId: '',
          amount: '',
          date: '',
          senderName: '',
          senderAddress: '',
          receiverName: '',
          receiverAccount: '',
        });
        loadSwifts();
      } else {
        setError(result.error || '创建失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">SWIFT水单管理</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowDirectCreate(true)}>
            <Plus className="h-4 w-4 mr-2" />
            直接创建
          </Button>
          <Button onClick={() => setShowUpload(true)}>
            <Upload className="h-4 w-4 mr-2" />
            上传SWIFT
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Input placeholder="搜索汇款人/收款人/账号" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="border rounded-md px-3 py-2 text-sm" value={hasErrorFilter} onChange={(e) => setHasErrorFilter(e.target.value)}>
            <option value="">全部状态</option>
            <option value="true">仅异常</option>
            <option value="false">仅正常</option>
          </select>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <Input type="number" placeholder="最小金额" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
          <Input type="number" placeholder="最大金额" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} />
          <div className="md:col-span-3 lg:col-span-6 flex justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setSearch('');
                setDateFrom('');
                setDateTo('');
                setMinAmount('');
                setMaxAmount('');
                setHasErrorFilter('');
              }}
            >
              重置筛选
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {swifts.map((swift) => (
          <Card key={swift.id} className={swift.hasError ? 'border-red-500' : ''}>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-lg">
                    SWIFT - {swift.date ? new Date(swift.date).toLocaleDateString() : '日期未知'}
                  </CardTitle>
                  <CardDescription>
                    汇款金额: ${swift.amount.toFixed(2)} | 汇款人: {swift.senderName || '-'}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={getSwiftStatus(swift) === 'RECEIVED' ? 'default' : (getSwiftStatus(swift) === 'ERROR' ? 'destructive' : 'outline')}>
                    {getSwiftStatus(swift)}
                  </Badge>
                  {swift.hasError && (
                    <AlertTriangle className="h-5 w-5 text-red-500" />
                  )}
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    onClick={() => handleDeleteSwift(swift.id)}
                    title="申请删除"
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {swift.hasError && swift.errorMessage && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{swift.errorMessage}</AlertDescription>
                </Alert>
              )}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-gray-500">汇款人:</span> {swift.senderName}</div>
                <div><span className="text-gray-500">汇款人地址:</span> {swift.senderAddress || '-'}</div>
                <div><span className="text-gray-500">收款人:</span> {swift.receiverName || '-'}</div>
                <div><span className="text-gray-500">收款账号:</span> {swift.receiverAccount || '-'}</div>
              </div>
            </CardContent>
          </Card>
        ))}
        {swifts.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-gray-500">
              暂无SWIFT水单
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={showUpload} onOpenChange={(open) => { setShowUpload(open); if (!open) { setError(null); setOcrResult(null); setImagePreview(null); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>上传SWIFT水单</DialogTitle>
            <DialogDescription>上传SWIFT水单图片，AI将自动识别内容</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div>
              <Label>选择付款明细</Label>
              <select 
                className="w-full mt-1 border rounded-md p-2"
                value={selectedDetailId}
                onChange={(e) => setSelectedDetailId(e.target.value)}
              >
                <option value="">请选择...</option>
                {waitingDetails.map((detail) => (
                  <option key={detail.id} value={detail.id}>
                    {detail.date ? new Date(detail.date).toLocaleDateString() : '日期未知'} - ${detail.totalAmount.toFixed(2)}
                  </option>
                ))}
              </select>
            </div>

            <div className="border-2 border-dashed rounded-lg p-4">
              <Input type="file" accept="image/*" onChange={handleFileSelect} />
            </div>

            {uploading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="ml-2">AI识别中...</span>
              </div>
            )}

            {imagePreview && (
              <div className="border rounded-lg p-2">
                <img src={imagePreview} alt="Preview" className="max-h-48 mx-auto rounded" />
              </div>
            )}

            {ocrResult && (
              <div className="space-y-3 border rounded-lg p-4">
                <h4 className="font-medium">识别结果</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-sm text-gray-500">汇款金额</Label>
                    <Input 
                      type="number"
                      value={(ocrResult.amount as number) || ''} 
                      onChange={(e) => setOcrResult({...ocrResult, amount: parseFloat(e.target.value)})}
                    />
                  </div>
                  <div>
                    <Label className="text-sm text-gray-500">汇款日期</Label>
                    <Input 
                      value={(ocrResult.date as string) || ''} 
                      onChange={(e) => setOcrResult({...ocrResult, date: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label className="text-sm text-gray-500">汇款人姓名</Label>
                    <Input 
                      value={(ocrResult.senderName as string) || ''} 
                      onChange={(e) => setOcrResult({...ocrResult, senderName: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label className="text-sm text-gray-500">收款人姓名</Label>
                    <Input 
                      value={(ocrResult.receiverName as string) || ''} 
                      onChange={(e) => setOcrResult({...ocrResult, receiverName: e.target.value})}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowUpload(false);
              setOcrResult(null);
              setImagePreview(null);
            }} disabled={submitting}>取消</Button>
            <Button onClick={handleConfirm} disabled={!ocrResult || !selectedDetailId || submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  处理中...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" /> 确认创建
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDirectCreate} onOpenChange={setShowDirectCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>直接创建SWIFT</DialogTitle>
            <DialogDescription>跳过AI识别，手动录入SWIFT信息</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>关联付款明细</Label>
              <select
                className="w-full mt-1 border rounded-md p-2"
                value={directForm.detailId}
                onChange={(e) => setDirectForm((prev) => ({ ...prev, detailId: e.target.value }))}
              >
                <option value="">请选择...</option>
                {waitingDetails.map((detail) => (
                  <option key={detail.id} value={detail.id}>
                    {detail.date ? new Date(detail.date).toLocaleDateString() : '日期未知'} - ${detail.totalAmount.toFixed(2)}
                  </option>
                ))}
              </select>
            </div>
            <Input type="number" placeholder="汇款金额" value={directForm.amount} onChange={(e) => setDirectForm((prev) => ({ ...prev, amount: e.target.value }))} />
            <Input type="date" placeholder="汇款日期" value={directForm.date} onChange={(e) => setDirectForm((prev) => ({ ...prev, date: e.target.value }))} />
            <Input placeholder="汇款人姓名" value={directForm.senderName} onChange={(e) => setDirectForm((prev) => ({ ...prev, senderName: e.target.value }))} />
            <Input placeholder="汇款人地址" value={directForm.senderAddress} onChange={(e) => setDirectForm((prev) => ({ ...prev, senderAddress: e.target.value }))} />
            <Input placeholder="收款人姓名" value={directForm.receiverName} onChange={(e) => setDirectForm((prev) => ({ ...prev, receiverName: e.target.value }))} />
            <Input placeholder="收款账号" value={directForm.receiverAccount} onChange={(e) => setDirectForm((prev) => ({ ...prev, receiverAccount: e.target.value }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDirectCreate(false)}>取消</Button>
            <Button onClick={handleDirectCreate}>
              <Check className="h-4 w-4 mr-2" />
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// 删除审批
function DeletionManager() {
  const { deletionRequests, setDeletionRequests, user } = useStore();
  const canApprove = user?.role === 'ADMIN';

  const loadRequests = useCallback(async () => {
    const result = await apiCall('deletion');
    if (result.success) {
      setDeletionRequests(result.data);
    }
  }, [setDeletionRequests]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const handleApprove = async (requestId: string) => {
    await apiCall('deletion', {
      method: 'POST',
      body: JSON.stringify({ action: 'approve', requestId }),
    });
    loadRequests();
  };

  const handleReject = async (requestId: string) => {
    await apiCall('deletion', {
      method: 'POST',
      body: JSON.stringify({ action: 'reject', requestId }),
    });
    loadRequests();
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      'PENDING': 'outline',
      'APPROVED': 'default',
      'REJECTED': 'destructive'
    };
    return <Badge variant={variants[status] || 'default'}>{status}</Badge>;
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">删除审批</h2>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>类型</TableHead>
                <TableHead>申请人</TableHead>
                <TableHead>原因</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deletionRequests.map((request) => (
                <TableRow key={request.id}>
                  <TableCell>{request.targetType}</TableCell>
                  <TableCell>{request.requester?.name || request.requester?.email}</TableCell>
                  <TableCell>{request.reason || '-'}</TableCell>
                  <TableCell>{getStatusBadge(request.status)}</TableCell>
                  <TableCell>{new Date(request.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    {request.status === 'PENDING' && canApprove && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="default" onClick={() => handleApprove(request.id)}>
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => handleReject(request.id)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {deletionRequests.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                    暂无删除申请
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// 用户管理
function UserManager() {
  const { users, setUsers, user } = useStore();
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', password: '', name: '', role: 'USER' as 'USER' | 'ADMIN' | 'SALES' });

  const loadUsers = useCallback(async () => {
    const result = await apiCall('auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'list' }),
    });
    if (result.success) {
      setUsers(result.data);
    }
  }, [setUsers]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleCreate = async () => {
    const result = await apiCall('auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', ...newUser, role: user?.role === 'SALES' ? 'USER' : newUser.role }),
    });
    if (result.success) {
      setShowCreate(false);
      setNewUser({ email: '', password: '', name: '', role: 'USER' });
      loadUsers();
    }
  };

  const handleResetPassword = async (userId: string) => {
    const password = window.prompt('请输入新密码（至少8位）');
    if (!password) return;
    const result = await apiCall('auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'reset-password', userId, password }),
    });
    if (!result.success) {
      alert(result.error || '重置失败');
    } else {
      alert('密码已重置');
    }
  };

  const handleDelete = async (userId: string) => {
    if (confirm('确定要删除此用户吗？')) {
      await apiCall('auth', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete', userId }),
      });
      loadUsers();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">用户管理</h2>
        <Button onClick={() => setShowCreate(true)}>
          <UserPlus className="h-4 w-4 mr-2" />
          创建用户
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>邮箱</TableHead>
                <TableHead>姓名</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.name || '-'}</TableCell>
                  <TableCell>
                    <Badge variant={user.role === 'ADMIN' ? 'default' : (user.role === 'SALES' ? 'outline' : 'secondary')}>
                      {user.role === 'ADMIN' ? '管理员' : user.role === 'SALES' ? '销售代表' : '用户'}
                    </Badge>
                  </TableCell>
                  <TableCell>{new Date(user.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => handleResetPassword(user.id)} title="重置密码">
                      <Key className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(user.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建用户</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>邮箱</Label>
              <Input 
                value={newUser.email} 
                onChange={(e) => setNewUser({...newUser, email: e.target.value})}
              />
            </div>
            <div>
              <Label>姓名</Label>
              <Input 
                value={newUser.name} 
                onChange={(e) => setNewUser({...newUser, name: e.target.value})}
              />
            </div>
            <div>
              <Label>密码</Label>
              <Input 
                type="password"
                value={newUser.password} 
                onChange={(e) => setNewUser({...newUser, password: e.target.value})}
              />
            </div>
            {user?.role === 'ADMIN' && (
              <div>
                <Label>角色</Label>
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm"
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value as 'USER' | 'ADMIN' | 'SALES' })}
                >
                  <option value="USER">USER</option>
                  <option value="ADMIN">ADMIN</option>
                  <option value="SALES">SALES</option>
                </select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>取消</Button>
            <Button onClick={handleCreate}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CustomerManager() {
  const { user } = useStore();
  const isAdmin = user?.role === 'ADMIN';
  const [customers, setCustomers] = useState<Array<Record<string, unknown>>>([]);
  const [fixOrders, setFixOrders] = useState<Array<Record<string, unknown>>>([]);
  const [fixReceipts, setFixReceipts] = useState<Array<Record<string, unknown>>>([]);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [fixingTarget, setFixingTarget] = useState<{ type: 'order' | 'receipt'; id: string } | null>(null);
  const [form, setForm] = useState({
    mark: '',
    name: '',
    phone: '',
    city: '',
    consignee: '',
    companyName: '',
    credit: '',
    companyAddress: '',
  });

  const resetForm = () => {
    setForm({
      mark: '',
      name: '',
      phone: '',
      city: '',
      consignee: '',
      companyName: '',
      credit: '',
      companyAddress: '',
    });
  };

  const loadCustomers = useCallback(async () => {
    const result = await apiCall(`customer${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''}`);
    if (result.success) setCustomers(Array.isArray(result.data) ? result.data : []);
  }, [search]);

  const loadFixes = useCallback(async () => {
    const result = await apiCall('customer/fixes');
    if (result.success && result.data) {
      setFixOrders(Array.isArray(result.data.orders) ? result.data.orders : []);
      setFixReceipts(Array.isArray(result.data.receipts) ? result.data.receipts : []);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => {
      void loadCustomers();
      void loadFixes();
    });
  }, [loadCustomers, loadFixes]);

  const handleCreateOrUpdate = async () => {
    const payload = {
      ...(editing ? { action: 'update', id: editing.id } : { action: 'create' }),
      mark: form.mark,
      name: form.name,
      phone: form.phone,
      city: form.city,
      consignee: form.consignee,
      companyName: form.companyName || null,
      companyAddress: form.companyAddress || null,
      credit: form.credit ? Number(form.credit) : null,
    };
    const result = await apiCall('customer', { method: 'POST', body: JSON.stringify(payload) });
    if (!result.success) {
      alert(result.error || '保存失败');
      return;
    }
    setShowCreate(false);
    setEditing(null);
    resetForm();
    loadCustomers();
  };

  const handleDelete = async (id: string) => {
    if (!isAdmin) return;
    if (!confirm('确定删除该客户吗？')) return;
    const result = await apiCall('customer', { method: 'POST', body: JSON.stringify({ action: 'delete', id }) });
    if (!result.success) {
      alert(result.error || '删除失败');
      return;
    }
    loadCustomers();
  };

  const openEdit = (row: Record<string, unknown>) => {
    setEditing(row);
    setForm({
      mark: String(row.mark || ''),
      name: String(row.name || ''),
      phone: String(row.phone || ''),
      city: String(row.city || ''),
      consignee: String(row.consignee || ''),
      companyName: String(row.companyName || ''),
      credit: row.credit === null || row.credit === undefined ? '' : String(row.credit),
      companyAddress: String(row.companyAddress || ''),
    });
    setShowCreate(true);
  };

  const openFix = (type: 'order' | 'receipt', row: Record<string, unknown>) => {
    setFixingTarget({ type, id: String(row.id) });
    setForm({
      mark: String(row.customerMark || ''),
      name: String(row.customerName || ''),
      phone: String(row.customerPhone || ''),
      city: String(row.customerCity || ''),
      consignee: '',
      companyName: '',
      credit: '',
      companyAddress: '',
    });
  };

  const submitFix = async () => {
    if (!fixingTarget) return;
    const payload = {
      action: fixingTarget.type === 'order' ? 'resolve-order' : 'resolve-receipt',
      ...(fixingTarget.type === 'order' ? { orderId: fixingTarget.id } : { receiptId: fixingTarget.id }),
      mark: form.mark,
      name: form.name,
      phone: form.phone,
      city: form.city,
      consignee: form.consignee,
      companyName: form.companyName || null,
      companyAddress: form.companyAddress || null,
      credit: form.credit ? Number(form.credit) : null,
    };
    const result = await apiCall('customer/fixes', { method: 'POST', body: JSON.stringify(payload) });
    if (!result.success) {
      alert(result.error || '修复失败');
      return;
    }
    setFixingTarget(null);
    resetForm();
    loadCustomers();
    loadFixes();
  };

  const canSeeExtended = isAdmin || customers.some((row) => row.companyName !== null || row.companyAddress !== null || row.credit !== null);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">客户管理</h2>
        <div className="flex gap-2">
          <Input placeholder="搜索 mark/name/phone/city" value={search} onChange={(e) => setSearch(e.target.value)} className="w-72" />
          <Button onClick={() => { setEditing(null); resetForm(); setShowCreate(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            新建客户
          </Button>
        </div>
      </div>

      <Tabs defaultValue="customers">
        <TabsList>
          <TabsTrigger value="customers">客户列表</TabsTrigger>
          <TabsTrigger value="fixes">待修复客户信息</TabsTrigger>
        </TabsList>

        <TabsContent value="customers">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>MARK</TableHead>
                    <TableHead>NAME</TableHead>
                    <TableHead>PHONE</TableHead>
                    <TableHead>CITY</TableHead>
                    <TableHead>CONSIGNEE</TableHead>
                    {canSeeExtended && <TableHead>COMPANY_NAME</TableHead>}
                    {canSeeExtended && <TableHead>CREDIT</TableHead>}
                    {canSeeExtended && <TableHead>COMPANY_ADDRESS</TableHead>}
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map((row) => (
                    <TableRow key={String(row.id)}>
                      <TableCell>{String(row.mark || '-')}</TableCell>
                      <TableCell>{String(row.name || '-')}</TableCell>
                      <TableCell>{String(row.phone || '-')}</TableCell>
                      <TableCell>{String(row.city || '-')}</TableCell>
                      <TableCell>{String(row.consignee || '-')}</TableCell>
                      {canSeeExtended && <TableCell>{String(row.companyName || '-')}</TableCell>}
                      {canSeeExtended && <TableCell>{row.credit !== null && row.credit !== undefined ? String(row.credit) : '-'}</TableCell>}
                      {canSeeExtended && <TableCell>{String(row.companyAddress || '-')}</TableCell>}
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {isAdmin && (
                          <Button size="sm" variant="ghost" onClick={() => handleDelete(String(row.id))}>
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="fixes">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>待修复 ORDER</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {fixOrders.map((row) => (
                  <div key={String(row.id)} className="flex justify-between items-center border rounded-md p-2">
                    <div>
                      <div className="font-medium">{String(row.orderNo || '-')}</div>
                      <div className="text-xs text-red-500">please modify guest information</div>
                    </div>
                    <Button size="sm" onClick={() => openFix('order', row)}>修复</Button>
                  </div>
                ))}
                {fixOrders.length === 0 && <p className="text-sm text-gray-500">暂无</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>待修复 RECEIPT</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {fixReceipts.map((row) => (
                  <div key={String(row.id)} className="flex justify-between items-center border rounded-md p-2">
                    <div>
                      <div className="font-medium">{String(row.receiptNo || row.orderNo || '-')}</div>
                      <div className="text-xs text-red-500">please modify guest information</div>
                    </div>
                    <Button size="sm" onClick={() => openFix('receipt', row)}>修复</Button>
                  </div>
                ))}
                {fixReceipts.length === 0 && <p className="text-sm text-gray-500">暂无</p>}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? '编辑客户' : '创建客户'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="MARK*" value={form.mark} onChange={(e) => setForm((p) => ({ ...p, mark: e.target.value }))} />
            <Input placeholder="NAME*" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            <Input placeholder="PHONE*" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
            <Input placeholder="CITY*" value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} />
            <Input placeholder="CONSIGNEE*" value={form.consignee} onChange={(e) => setForm((p) => ({ ...p, consignee: e.target.value }))} />
            {isAdmin && (
              <>
                <Input placeholder="COMPANY_NAME" value={form.companyName} onChange={(e) => setForm((p) => ({ ...p, companyName: e.target.value }))} />
                <Input placeholder="CREDIT" type="number" value={form.credit} onChange={(e) => setForm((p) => ({ ...p, credit: e.target.value }))} />
                <Input placeholder="COMPANY_ADDRESS" value={form.companyAddress} onChange={(e) => setForm((p) => ({ ...p, companyAddress: e.target.value }))} />
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>取消</Button>
            <Button onClick={handleCreateOrUpdate}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!fixingTarget} onOpenChange={(open) => { if (!open) setFixingTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修复客户信息并加入客户库</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="MARK*" value={form.mark} onChange={(e) => setForm((p) => ({ ...p, mark: e.target.value }))} />
            <Input placeholder="NAME*" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            <Input placeholder="PHONE*" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
            <Input placeholder="CITY*" value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} />
            <Input placeholder="CONSIGNEE*" value={form.consignee} onChange={(e) => setForm((p) => ({ ...p, consignee: e.target.value }))} />
            {isAdmin && (
              <>
                <Input placeholder="COMPANY_NAME" value={form.companyName} onChange={(e) => setForm((p) => ({ ...p, companyName: e.target.value }))} />
                <Input placeholder="CREDIT" type="number" value={form.credit} onChange={(e) => setForm((p) => ({ ...p, credit: e.target.value }))} />
                <Input placeholder="COMPANY_ADDRESS" value={form.companyAddress} onChange={(e) => setForm((p) => ({ ...p, companyAddress: e.target.value }))} />
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFixingTarget(null)}>取消</Button>
            <Button onClick={submitFix}>修复并保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SettingsManager() {
  const { user } = useStore();
  const [loading, setLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [canEditConfig, setCanEditConfig] = useState(false);
  const [pwd, setPwd] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiCall('settings');
      if (result.success) {
        setConfig(result.data.settings || {});
        setCanEditConfig(Boolean(result.data.canEdit));
      }
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSaveConfig = async () => {
    if (!canEditConfig) return;
    setSavingConfig(true);
    setError(null);
    setMessage(null);
    try {
      const result = await apiCall('settings', {
        method: 'POST',
        body: JSON.stringify({ action: 'update-config', settings: config }),
      });
      if (result.success) {
        setMessage(result.message || '配置已保存');
      } else {
        setError(result.error || '保存失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleChangePassword = async () => {
    setError(null);
    setMessage(null);
    if (!pwd.oldPassword || !pwd.newPassword || !pwd.confirmPassword) {
      setError('请填写完整密码信息');
      return;
    }
    if (pwd.newPassword !== pwd.confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }
    setPasswordLoading(true);
    try {
      const result = await apiCall('auth', {
        method: 'POST',
        body: JSON.stringify({
          action: 'change-password',
          oldPassword: pwd.oldPassword,
          newPassword: pwd.newPassword,
        }),
      });
      if (result.success) {
        setPwd({ oldPassword: '', newPassword: '', confirmPassword: '' });
        setMessage(result.message || '密码修改成功');
      } else {
        setError(result.error || '密码修改失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '密码修改失败');
    } finally {
      setPasswordLoading(false);
    }
  };

  const updateConfigField = (key: string, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">设置</h2>
      {(error || message) && (
        <Alert variant={error ? 'destructive' : 'default'}>
          <AlertDescription>{error || message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>修改密码</CardTitle>
          <CardDescription>当前账号：{user?.email}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            type="password"
            placeholder="旧密码"
            value={pwd.oldPassword}
            onChange={(e) => setPwd((prev) => ({ ...prev, oldPassword: e.target.value }))}
          />
          <Input
            type="password"
            placeholder="新密码（至少8位）"
            value={pwd.newPassword}
            onChange={(e) => setPwd((prev) => ({ ...prev, newPassword: e.target.value }))}
          />
          <Input
            type="password"
            placeholder="确认新密码"
            value={pwd.confirmPassword}
            onChange={(e) => setPwd((prev) => ({ ...prev, confirmPassword: e.target.value }))}
          />
          <div className="flex justify-end">
            <Button onClick={handleChangePassword} disabled={passwordLoading}>
              {passwordLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Key className="h-4 w-4 mr-2" />
              保存新密码
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>系统配置</CardTitle>
          <CardDescription>配置通过设置按钮修改，保存后立即生效（管理员权限）</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="py-8 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>OCR_API_BASE_URL</Label>
                  <Input value={config.OCR_API_BASE_URL || ''} onChange={(e) => updateConfigField('OCR_API_BASE_URL', e.target.value)} disabled={!canEditConfig} />
                </div>
                <div>
                  <Label>OCR_MODEL</Label>
                  <Input value={config.OCR_MODEL || ''} onChange={(e) => updateConfigField('OCR_MODEL', e.target.value)} disabled={!canEditConfig} />
                </div>
                <div>
                  <Label>OCR_API_KEY</Label>
                  <Input type="password" value={config.OCR_API_KEY || ''} onChange={(e) => updateConfigField('OCR_API_KEY', e.target.value)} disabled={!canEditConfig} />
                </div>
                <div>
                  <Label>OCR_DISABLED</Label>
                  <select
                    className="w-full border rounded-md px-3 py-2 text-sm"
                    value={config.OCR_DISABLED || 'false'}
                    onChange={(e) => updateConfigField('OCR_DISABLED', e.target.value)}
                    disabled={!canEditConfig}
                  >
                    <option value="false">false</option>
                    <option value="true">true</option>
                  </select>
                </div>
                <div>
                  <Label>OCR_MAX_RETRIES</Label>
                  <Input value={config.OCR_MAX_RETRIES || ''} onChange={(e) => updateConfigField('OCR_MAX_RETRIES', e.target.value)} disabled={!canEditConfig} />
                </div>
                <div>
                  <Label>OCR_TIMEOUT_MS</Label>
                  <Input value={config.OCR_TIMEOUT_MS || ''} onChange={(e) => updateConfigField('OCR_TIMEOUT_MS', e.target.value)} disabled={!canEditConfig} />
                </div>
                <div>
                  <Label>OCR_RETRY_BASE_DELAY_MS</Label>
                  <Input value={config.OCR_RETRY_BASE_DELAY_MS || ''} onChange={(e) => updateConfigField('OCR_RETRY_BASE_DELAY_MS', e.target.value)} disabled={!canEditConfig} />
                </div>
                <div>
                  <Label>OCR_INPUT_COST_PER_1K</Label>
                  <Input value={config.OCR_INPUT_COST_PER_1K || ''} onChange={(e) => updateConfigField('OCR_INPUT_COST_PER_1K', e.target.value)} disabled={!canEditConfig} />
                </div>
                <div>
                  <Label>OCR_OUTPUT_COST_PER_1K</Label>
                  <Input value={config.OCR_OUTPUT_COST_PER_1K || ''} onChange={(e) => updateConfigField('OCR_OUTPUT_COST_PER_1K', e.target.value)} disabled={!canEditConfig} />
                </div>
                <div>
                  <Label>SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS</Label>
                  <select
                    className="w-full border rounded-md px-3 py-2 text-sm"
                    value={config.SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS || 'false'}
                    onChange={(e) => updateConfigField('SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS', e.target.value)}
                    disabled={!canEditConfig}
                  >
                    <option value="false">false</option>
                    <option value="true">true</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={handleSaveConfig} disabled={!canEditConfig || savingConfig}>
                  {savingConfig && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  <Save className="h-4 w-4 mr-2" />
                  保存系统配置
                </Button>
              </div>
              {!canEditConfig && <p className="text-sm text-gray-500">仅管理员可编辑系统配置。</p>}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// 主应用
export default function HomePage() {
  const { user, setUser, currentView } = useStore();
  const [initialized, setInitialized] = useState(false);

  // 检查登录状态
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
      case 'users':
        return <UserManager />;
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
