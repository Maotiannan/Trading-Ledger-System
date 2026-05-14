'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { apiCall, useLatestRequestGuard, useUiText } from '@/components/workspace/shared';
import { formatOrderNameDisplay, formatUsdAmount } from '@/lib/display-format';
import { CheckSquare, Loader2, Pencil, Plus, Search } from 'lucide-react';
import type { OrderTrackerCustomerOption, OrderTrackerRow } from './types';

const MAX_REMARK_LENGTH = 300;

type OrderTrackerApiResult = {
  success?: boolean;
  data?: OrderTrackerRow[];
  meta?: {
    statusOptions?: string[];
    defaultStatus?: string;
  };
  message?: string;
};

type DialogMode = 'create' | 'edit';

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'Confirmed') return 'default';
  if (status === 'Canceled') return 'destructive';
  return 'secondary';
}

function emptyForm(defaultStatus: string) {
  return {
    orderNo: '',
    customerId: '',
    status: defaultStatus,
    piStatus: false,
    remark: '',
    systemNote: '',
  };
}

export function OrderTrackerManager() {
  const tx = useUiText();
  const requestGuard = useLatestRequestGuard();
  const [orders, setOrders] = useState<OrderTrackerRow[]>([]);
  const [customers, setCustomers] = useState<OrderTrackerCustomerOption[]>([]);
  const [statusOptions, setStatusOptions] = useState<string[]>(['In progress', 'Confirmed', 'Canceled']);
  const [defaultStatus, setDefaultStatus] = useState('In progress');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>('create');
  const [editingOrder, setEditingOrder] = useState<OrderTrackerRow | null>(null);
  const [form, setForm] = useState(emptyForm(defaultStatus));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadOrders = useCallback(async () => {
    const token = requestGuard.nextToken();
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter && statusFilter !== 'ALL') params.set('status', statusFilter);
      const endpoint = `orders${params.toString() ? `?${params.toString()}` : ''}`;
      const result = await apiCall(endpoint) as OrderTrackerApiResult;
      if (!requestGuard.isLatest(token)) return;
      if (result.success && Array.isArray(result.data)) {
        setOrders(result.data);
        const nextOptions = result.meta?.statusOptions?.length ? result.meta.statusOptions : ['In progress', 'Confirmed', 'Canceled'];
        const nextDefaultStatus = result.meta?.defaultStatus || nextOptions[0] || 'In progress';
        setStatusOptions(nextOptions);
        setDefaultStatus(nextDefaultStatus);
      }
    } catch (err) {
      if (requestGuard.isLatest(token)) {
        setError(err instanceof Error ? err.message : tx('Orders加载失败', 'Failed to load Orders'));
      }
    } finally {
      if (requestGuard.isLatest(token)) setLoading(false);
    }
  }, [requestGuard, search, statusFilter, tx]);

  const loadCustomers = useCallback(async () => {
    try {
      const result = await apiCall('orders?action=customer-options');
      if (result.success && Array.isArray(result.data)) {
        setCustomers(result.data as OrderTrackerCustomerOption[]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tx('客户候选加载失败', 'Failed to load customer options'));
    }
  }, [tx]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === form.customerId) || null,
    [customers, form.customerId],
  );

  const openCreateDialog = () => {
    setDialogMode('create');
    setEditingOrder(null);
    setForm(emptyForm(defaultStatus));
    setError('');
    setMessage('');
    setDialogOpen(true);
    void loadCustomers();
  };

  const openEditDialog = (row: OrderTrackerRow) => {
    setDialogMode('edit');
    setEditingOrder(row);
    setForm({
      orderNo: row.orderNo,
      customerId: row.customerId || '',
      status: row.status || defaultStatus,
      piStatus: Boolean(row.piStatus),
      remark: row.remark || '',
      systemNote: row.systemNote || '',
    });
    setError('');
    setMessage('');
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      if (dialogMode === 'create') {
        if (!form.orderNo.trim()) throw new Error(tx('ORDER不能为空', 'ORDER is required'));
        if (!form.customerId) throw new Error(tx('CUSTOMER不能为空', 'CUSTOMER is required'));
        const result = await apiCall('orders', {
          method: 'POST',
          body: JSON.stringify({
            action: 'create',
            orderNo: form.orderNo.trim(),
            customerId: form.customerId,
            status: form.status,
            remark: form.remark.trim(),
          }),
        });
        setMessage(result.message || tx('Order已创建', 'Order created'));
      } else if (editingOrder) {
        const result = await apiCall('orders', {
          method: 'POST',
          body: JSON.stringify({
            action: 'update',
            orderId: editingOrder.id,
            status: form.status,
            remark: form.remark.trim(),
            piStatus: form.piStatus,
            systemNote: form.systemNote.trim(),
          }),
        });
        setMessage(result.message || tx('Order已更新', 'Order updated'));
      }
      setDialogOpen(false);
      await loadOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : tx('保存失败', 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const canSave = dialogMode === 'create'
    ? Boolean(form.orderNo.trim() && form.customerId && form.remark.length <= MAX_REMARK_LENGTH)
    : Boolean(editingOrder && (editingOrder.canEdit || editingOrder.canEditAdminFields) && form.remark.length <= MAX_REMARK_LENGTH);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold">{tx('Orders', 'Orders')}</h2>
          <p className="text-sm text-muted-foreground">
            {tx('独立业务订单跟踪，不参与财务订单余额和匹配逻辑。', 'Independent business order tracking; it does not affect finance order balances or matching.')}
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          {tx('新增Order', 'New Order')}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {message && (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_220px_auto]">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={tx('搜索ORDER / 客户 / 备注', 'Search ORDER / customer / note')}
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={tx('状态', 'Status')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{tx('全部状态', 'All status')}</SelectItem>
                {statusOptions.map((status) => (
                  <SelectItem key={status} value={status}>{status}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => void loadOrders()} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              {tx('查询', 'Search')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ORDER</TableHead>
                  <TableHead>STATUS</TableHead>
                  <TableHead>PI STATUS</TableHead>
                  <TableHead>REMARK</TableHead>
                  <TableHead>SYSTEM NOTED</TableHead>
                  <TableHead>DEPOSIT</TableHead>
                  <TableHead>{tx('客户', 'Customer')}</TableHead>
                  <TableHead>{tx('操作', 'Actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-semibold">{formatOrderNameDisplay(row.orderNo)}</TableCell>
                    <TableCell><Badge variant={statusBadgeVariant(row.status)}>{row.status}</Badge></TableCell>
                    <TableCell>
                      {row.piStatus ? (
                        <Badge variant="default" className="gap-1"><CheckSquare className="h-3 w-3" />PI</Badge>
                      ) : '-'}
                    </TableCell>
                    <TableCell className="min-w-[220px] whitespace-pre-wrap">{row.remark || '-'}</TableCell>
                    <TableCell className="min-w-[220px] whitespace-pre-wrap">{row.systemNote || '-'}</TableCell>
                    <TableCell className="font-medium">{row.depositAmount ? formatUsdAmount(row.depositAmount) : '-'}</TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{row.customerMark || '-'}</div>
                      <div className="text-xs text-muted-foreground">{row.customerName || row.customerPhone || '-'}</div>
                    </TableCell>
                    <TableCell>
                      {(row.canEdit || row.canEditAdminFields) ? (
                        <Button size="sm" variant="outline" onClick={() => openEditDialog(row)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          {tx('修改', 'Edit')}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">{tx('只读', 'Read only')}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {orders.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                      {loading ? tx('加载中...', 'Loading...') : tx('暂无Orders记录', 'No Orders records')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{dialogMode === 'create' ? tx('新增Order', 'New Order') : tx('修改Order', 'Edit Order')}</DialogTitle>
            <DialogDescription>
              {dialogMode === 'create'
                ? tx('ORDER NO会先严格检查财务订单和别名，已存在则不能创建。', 'ORDER is strictly checked against finance orders and aliases before creation.')
                : tx('基础字段由可见范围内账号修改；PI STATUS和SYSTEM NOTED仅上级ADMIN可修改。', 'Base fields are editable within the visible scope; PI STATUS and SYSTEM NOTED require an upper ADMIN.')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>ORDER</Label>
              <Input
                value={form.orderNo}
                onChange={(event) => setForm((prev) => ({ ...prev, orderNo: event.target.value.toUpperCase() }))}
                disabled={dialogMode === 'edit'}
                placeholder="PIKIN-23"
              />
            </div>

            <div className="grid gap-2">
              <Label>CUSTOMER</Label>
              <Select
                value={form.customerId}
                onValueChange={(value) => setForm((prev) => ({ ...prev, customerId: value }))}
                disabled={dialogMode === 'edit'}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={tx('选择客户', 'Select customer')} />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>{customer.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedCustomer && (
                <p className="text-xs text-muted-foreground">
                  {selectedCustomer.phone} · {selectedCustomer.city}
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label>STATUS</Label>
              <Select
                value={form.status}
                onValueChange={(value) => setForm((prev) => ({ ...prev, status: value }))}
                disabled={dialogMode === 'edit' && !editingOrder?.canEdit}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="STATUS" />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((status) => (
                    <SelectItem key={status} value={status}>{status}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>REMARK</Label>
                <span className="text-xs text-muted-foreground">{form.remark.length}/{MAX_REMARK_LENGTH}</span>
              </div>
              <Textarea
                value={form.remark}
                onChange={(event) => setForm((prev) => ({ ...prev, remark: event.target.value.slice(0, MAX_REMARK_LENGTH) }))}
                disabled={dialogMode === 'edit' && !editingOrder?.canEdit}
                rows={3}
              />
            </div>

            <div className="flex items-center gap-3 rounded-md border p-3">
              <Checkbox
                checked={form.piStatus}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, piStatus: checked === true }))}
                disabled={dialogMode === 'create' || !editingOrder?.canEditAdminFields}
                id="orders-pi-status"
              />
              <Label htmlFor="orders-pi-status" className="cursor-pointer">PI STATUS</Label>
            </div>

            <div className="grid gap-2">
              <Label>SYSTEM NOTED</Label>
              <Textarea
                value={form.systemNote}
                onChange={(event) => setForm((prev) => ({ ...prev, systemNote: event.target.value }))}
                disabled={dialogMode === 'create' || !editingOrder?.canEditAdminFields}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter className="sticky bottom-0 bg-background pt-3">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              {tx('取消', 'Cancel')}
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving || !canSave}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {dialogMode === 'create' ? tx('创建', 'Create') : tx('保存', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
