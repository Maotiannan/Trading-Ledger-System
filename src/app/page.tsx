'use client';

import { useState, useEffect, useCallback } from 'react';
import { useStore } from '@/lib/store';
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
  History, ArrowRight, RefreshCw, UserPlus, Key, LayoutDashboard,
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

  return response.json();
}

// 登录组件
function LoginPage() {
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
        setError(result.error || '登录失败');
      }
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">收汇管理系统</CardTitle>
          <CardDescription>请登录以继续</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
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
              <Label htmlFor="password">密码</Label>
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
              登录
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// 侧边导航栏
function Sidebar() {
  const { user, currentView, setCurrentView, setUser } = useStore();

  const handleLogout = async () => {
    await apiCall('auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'logout' }),
    });
    setUser(null);
  };

  const menuItems = [
    { id: 'dashboard' as const, label: '仪表盘', icon: LayoutDashboard },
    { id: 'invoices' as const, label: '账单管理', icon: FileText, adminOnly: true },
    { id: 'receipts' as const, label: '收据管理', icon: Receipt },
    { id: 'details' as const, label: '付款明细', icon: FileSpreadsheet },
    { id: 'swifts' as const, label: 'SWIFT水单', icon: Building2 },
    { id: 'deletions' as const, label: '删除审批', icon: Trash2, adminOnly: true },
    { id: 'users' as const, label: '用户管理', icon: Users, adminOnly: true },
  ];

  return (
    <div className="w-64 bg-white dark:bg-gray-800 border-r h-screen flex flex-col">
      <div className="p-4 border-b">
        <h1 className="text-xl font-bold">收汇管理系统</h1>
        <p className="text-sm text-gray-500 mt-1">
          {user?.name || user?.email} 
          <Badge variant={user?.role === 'ADMIN' ? 'default' : 'secondary'} className="ml-2">
            {user?.role === 'ADMIN' ? '管理员' : '用户'}
          </Badge>
        </p>
      </div>
      <nav className="flex-1 p-2">
        {menuItems.map((item) => {
          if (item.adminOnly && user?.role !== 'ADMIN') return null;
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
          退出登录
        </Button>
      </div>
    </div>
  );
}

// 仪表盘
function Dashboard() {
  const { invoices, receipts, details, swifts, deletionRequests } = useStore();
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  
  const stats = [
    { label: '账单总数', value: invoices.length, color: 'text-blue-600' },
    { label: '待处理收据', value: receipts.filter(r => r.status === 'SR_Received').length, color: 'text-yellow-600' },
    { label: '等待SWIFT', value: details.filter(d => d.status === 'Waiting_SWIFT').length, color: 'text-orange-600' },
    { label: '银行转账中', value: details.filter(d => d.status === 'Bank_Transfer').length, color: 'text-purple-600' },
    { label: '待审批删除', value: deletionRequests.filter(d => d.status === 'PENDING').length, color: 'text-red-600' },
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
        alert(error.error || '导出失败');
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
      alert('导出失败，请稍后重试');
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">仪表盘</h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => handleExport('excel')}
            disabled={exporting !== null}
          >
            {exporting === 'excel' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            导出 Excel
          </Button>
          <Button
            variant="outline"
            onClick={() => handleExport('pdf')}
            disabled={exporting !== null}
          >
            {exporting === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            导出 PDF
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
            <CardTitle>最近收据</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              {receipts.slice(0, 5).map((receipt) => (
                <div key={receipt.id} className="flex justify-between items-center py-2 border-b">
                  <div>
                    <p className="font-medium">{receipt.orderNo || receipt.receiptNo || '未命名'}</p>
                    <p className="text-sm text-gray-500">${receipt.usd.toFixed(2)}</p>
                  </div>
                  <Badge>{receipt.status}</Badge>
                </div>
              ))}
              {receipts.length === 0 && <p className="text-gray-500 text-center py-4">暂无数据</p>}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>最近付款明细</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              {details.slice(0, 5).map((detail) => (
                <div key={detail.id} className="flex justify-between items-center py-2 border-b">
                  <div>
                    <p className="font-medium">{detail.items.length} 笔明细</p>
                    <p className="text-sm text-gray-500">总计: ${detail.totalAmount.toFixed(2)}</p>
                  </div>
                  <Badge variant={detail.status === 'ERROR' ? 'destructive' : 'default'}>{detail.status}</Badge>
                </div>
              ))}
              {details.length === 0 && <p className="text-gray-500 text-center py-4">暂无数据</p>}
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
  const [showDialog, setShowDialog] = useState(false);
  const [invNo, setInvNo] = useState('');
  const [orders, setOrders] = useState<{ orderNo: string; amount: string }[]>([{ orderNo: '', amount: '' }]);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  // 展开状态
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());
  
  // 编辑订单对话框
  const [editingOrder, setEditingOrder] = useState<{ id: string; orderNo: string; amount: number; invoiceId: string } | null>(null);
  const [showOrderDialog, setShowOrderDialog] = useState(false);
  const [orderFormError, setOrderFormError] = useState('');
  
  // 添加订单到现有账单
  const [addingOrderToInvoice, setAddingOrderToInvoice] = useState<string | null>(null);
  const [newOrderNo, setNewOrderNo] = useState('');
  const [newOrderAmount, setNewOrderAmount] = useState('');
  const [addError, setAddError] = useState('');
  
  // 转移余额对话框
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [transferFromOrder, setTransferFromOrder] = useState<{ id: string; orderNo: string; balance: number } | null>(null);
  const [transferToOrderNo, setTransferToOrderNo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferError, setTransferError] = useState('');
  
  // 刷新匹配状态
  const [refreshing, setRefreshing] = useState(false);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    const result = await apiCall('invoice');
    if (result.success) {
      setInvoices(result.data);
    }
    setLoading(false);
  }, [setInvoices, setLoading]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

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
          orders: orders.map(o => ({ orderNo: o.orderNo, amount: parseFloat(o.amount) }))
        }),
      });

      if (result.success) {
        setShowDialog(false);
        setInvNo('');
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
    
    if (!editingOrder.amount || editingOrder.amount <= 0) {
      setOrderFormError('请输入有效金额');
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
          amount: editingOrder.amount
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

    setSubmitting(true);
    
    try {
      const result = await apiCall('invoice', {
        method: 'PUT',
        body: JSON.stringify({
          action: 'addOrder',
          invoiceId: addingOrderToInvoice,
          orderNo: newOrderNo,
          amount: parseFloat(newOrderAmount)
        }),
      });

      if (result.success) {
        setAddingOrderToInvoice(null);
        setNewOrderNo('');
        setNewOrderAmount('');
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

  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">账单管理</h2>
        <div className="flex gap-2">
          {isAdmin && (
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
                创建账单
              </Button>
            </>
          )}
        </div>
      </div>

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
                  {isAdmin && (
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
                      <TableHead>金额 (AMOUNT)</TableHead>
                      <TableHead>未收金额</TableHead>
                      {isAdmin && <TableHead className="text-right">操作</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.orders.map((order) => {
                      const isSystemOrder = (order as Order & { isSystemOrder?: boolean }).isSystemOrder;
                      return (
                        <TableRow key={order.id}>
                          <TableCell className="font-medium">{order.orderNo}</TableCell>
                          <TableCell>
                            {isSystemOrder ? '-' : `$${order.amount.toFixed(2)}`}
                          </TableCell>
                          <TableCell className={order.orderBalance > 0 ? 'text-red-500' : 'text-green-500'}>
                            ${Math.abs(order.orderBalance).toFixed(2)}
                            {order.orderBalance < 0 && <span className="ml-1 text-xs">(多付)</span>}
                          </TableCell>
                          {isAdmin && (
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
                                    invoiceId: invoice.id
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
                        <TableCell colSpan={isAdmin ? 4 : 3} className="text-center py-4 text-gray-500">
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
    </div>
  );
}

// 收据管理
function ReceiptManager() {
  const { receipts, setReceipts, loading, setLoading, user } = useStore();
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ocrResult, setOcrResult] = useState<Record<string, unknown> | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // 图片查看对话框
  const [viewingImage, setViewingImage] = useState<{ url: string; name: string } | null>(null);
  
  // 分页
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 30;
  const totalPages = Math.ceil(receipts.length / pageSize);
  const paginatedReceipts = receipts.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const loadReceipts = useCallback(async () => {
    setLoading(true);
    const result = await apiCall('receipt');
    if (result.success) {
      setReceipts(result.data);
    }
    setLoading(false);
  }, [setReceipts, setLoading]);

  useEffect(() => {
    loadReceipts();
  }, [loadReceipts]);

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

  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">收据管理</h2>
        <Button onClick={() => setShowUpload(true)}>
          <Upload className="h-4 w-4 mr-2" />
          上传收据
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>收据号</TableHead>
                <TableHead>客户单号</TableHead>
                <TableHead>付款金额</TableHead>
                <TableHead>付款人</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedReceipts.map((receipt) => (
                <TableRow key={receipt.id}>
                  <TableCell>{receipt.receiptNo || '-'}</TableCell>
                  <TableCell>{receipt.orderNo || '-'}</TableCell>
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
                      {receipt.status === 'Bank_Transfer' && isAdmin && (
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
                  <TableCell colSpan={7} className="text-center py-8 text-gray-500">
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
      <Dialog open={showUpload} onOpenChange={(open) => { setShowUpload(open); if (!open) { setError(null); setOcrResult(null); setImagePreview(null); } }}>
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
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ocrResult, setOcrResult] = useState<{ date: string | null; items: { mark: string | null; orderNo: string | null; amount: number; matchedReceiptId?: string | null }[] } | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 服务器保存的图片路径
  const [savedImagePath, setSavedImagePath] = useState<{ path: string; name: string } | null>(null);
  
  // 折叠状态
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(new Set());
  
  // 图片查看对话框
  const [viewingImage, setViewingImage] = useState<{ url: string; name: string } | null>(null);

  const loadDetails = useCallback(async () => {
    const result = await apiCall('detail');
    if (result.success) {
      setDetails(result.data);
    }
  }, [setDetails]);

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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">付款明细管理</h2>
        <Button onClick={() => setShowUpload(true)}>
          <Upload className="h-4 w-4 mr-2" />
          上传付款明细
        </Button>
      </div>

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
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ocrResult, setOcrResult] = useState<Record<string, unknown> | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedDetailId, setSelectedDetailId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const loadSwifts = useCallback(async () => {
    const result = await apiCall('swift');
    if (result.success) {
      setSwifts(result.data);
    }
  }, [setSwifts]);

  useEffect(() => {
    loadSwifts();
  }, [loadSwifts]);

  const waitingDetails = details.filter(d => d.status === 'Waiting_SWIFT');

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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">SWIFT水单管理</h2>
        <Button onClick={() => setShowUpload(true)}>
          <Upload className="h-4 w-4 mr-2" />
          上传SWIFT
        </Button>
      </div>

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
    </div>
  );
}

// 删除审批
function DeletionManager() {
  const { deletionRequests, setDeletionRequests } = useStore();

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
                    {request.status === 'PENDING' && (
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
  const { users, setUsers } = useStore();
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', password: '', name: '' });

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
      body: JSON.stringify({ action: 'create', ...newUser }),
    });
    if (result.success) {
      setShowCreate(false);
      setNewUser({ email: '', password: '', name: '' });
      loadUsers();
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
                    <Badge variant={user.role === 'ADMIN' ? 'default' : 'secondary'}>
                      {user.role === 'ADMIN' ? '管理员' : '用户'}
                    </Badge>
                  </TableCell>
                  <TableCell>{new Date(user.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>
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

// 主应用
export default function HomePage() {
  const { user, setUser, currentView } = useStore();
  const [initialized, setInitialized] = useState(false);

  // 检查登录状态
  useEffect(() => {
    const checkAuth = async () => {
      const result = await apiCall('auth', {
        method: 'POST',
        body: JSON.stringify({ action: 'me' }),
      });
      if (result.success && result.data) {
        setUser(result.data);
      } else {
        setUser(null);
      }
      setInitialized(true);
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
