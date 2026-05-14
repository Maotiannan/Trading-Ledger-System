'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { apiCall, lookupOrderContextByOrderNo, useLatestRequestGuard, useUiText } from '@/components/workspace/shared';
import { formatOrderNameDisplay, formatUsdAmount } from '@/lib/display-format';
import { CheckSquare, Loader2, Pencil, Plus, Search } from 'lucide-react';
import type { OrderTrackerCustomerOption, OrderTrackerRow } from './types';

const MAX_REMARK_LENGTH = 300;
const DEFAULT_STATUS_LABELS: Record<string, { zh: string; en: string }> = {
  'In progress': { zh: '进行中', en: 'In progress' },
  Confirmed: { zh: '已确认', en: 'Confirmed' },
  Canceled: { zh: '已取消', en: 'Canceled' },
};

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

function customerOptionLabel(customer: Pick<OrderTrackerCustomerOption, 'label' | 'mark' | 'orderName' | 'companyName' | 'name'>): string {
  return customer.label || `${customer.mark} / ${customer.orderName} / ${customer.companyName || customer.name || ''}`.trim();
}

export function OrderTrackerManager() {
  const tx = useUiText();
  const requestGuard = useLatestRequestGuard();
  const orderLookupSequenceRef = useRef(0);
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
  const [customerLookupLoading, setCustomerLookupLoading] = useState(false);
  const [customerLookupHint, setCustomerLookupHint] = useState('');
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

  const loadCustomers = useCallback(async (customerSearch = ''): Promise<OrderTrackerCustomerOption[]> => {
    try {
      const params = new URLSearchParams({ action: 'customer-options' });
      if (customerSearch.trim()) params.set('search', customerSearch.trim());
      const result = await apiCall(`orders?${params.toString()}`);
      if (result.success && Array.isArray(result.data)) {
        const rows = result.data as OrderTrackerCustomerOption[];
        setCustomers(rows);
        return rows;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tx('客户候选加载失败', 'Failed to load customer options'));
    }
    return [];
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
  const selectedCustomerLabel = selectedCustomer ? customerOptionLabel(selectedCustomer) : '';

  const statusLabel = useCallback((status: string) => {
    const mapped = DEFAULT_STATUS_LABELS[status];
    return mapped ? tx(mapped.zh, mapped.en) : status;
  }, [tx]);

  const handleOrderNoChange = (value: string) => {
    setForm((prev) => ({ ...prev, orderNo: value.toUpperCase(), customerId: '' }));
    setCustomerLookupHint('');
  };

  const openCreateDialog = () => {
    setDialogMode('create');
    setEditingOrder(null);
    setForm(emptyForm(defaultStatus));
    setCustomerLookupLoading(false);
    setCustomerLookupHint('');
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
    setCustomerLookupLoading(false);
    setCustomerLookupHint('');
    setError('');
    setMessage('');
    setDialogOpen(true);
  };

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      orderLookupSequenceRef.current += 1;
      setCustomerLookupLoading(false);
      setCustomerLookupHint('');
    }
  };

  useEffect(() => {
    if (!dialogOpen || dialogMode !== 'create') return;
    const orderNo = form.orderNo.trim();
    if (!orderNo) {
      setCustomerLookupHint('');
      setCustomerLookupLoading(false);
      return;
    }

    const sequence = orderLookupSequenceRef.current + 1;
    orderLookupSequenceRef.current = sequence;
    setCustomerLookupLoading(true);

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const context = await lookupOrderContextByOrderNo(orderNo);
          if (orderLookupSequenceRef.current !== sequence) return;
          const matched = context.matchedCustomer;
          if (!matched?.customerId) {
            setCustomerLookupHint(tx('未匹配到客户，请手动选择。', 'No customer matched. Please select manually.'));
            return;
          }

          const rows = await loadCustomers(matched.mark);
          if (orderLookupSequenceRef.current !== sequence) return;
          const matchedOption = rows.find((row) => row.id === matched.customerId) || {
            id: matched.customerId,
            mark: matched.mark,
            orderName: matched.name,
            name: matched.name,
            companyName: null,
            phone: '',
            city: '',
            ownerId: '',
            label: `${matched.mark} / ${matched.name} / ${matched.name}`,
          };
          if (!rows.some((row) => row.id === matched.customerId)) {
            setCustomers((prev) => [matchedOption, ...prev.filter((row) => row.id !== matched.customerId)]);
          }
          setForm((prev) => (
            prev.orderNo.trim() === orderNo
              ? { ...prev, customerId: matched.customerId }
              : prev
          ));
          setCustomerLookupHint(tx(`已匹配客户：${matchedOption.label}`, `Matched customer: ${matchedOption.label}`));
        } catch (err) {
          if (orderLookupSequenceRef.current !== sequence) return;
          setCustomerLookupHint(err instanceof Error ? err.message : tx('客户匹配失败，请手动选择。', 'Customer match failed. Please select manually.'));
        } finally {
          if (orderLookupSequenceRef.current === sequence) setCustomerLookupLoading(false);
        }
      })();
    }, 260);

    return () => clearTimeout(timer);
  }, [dialogMode, dialogOpen, form.orderNo, loadCustomers, tx]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      if (dialogMode === 'create') {
        if (!form.orderNo.trim()) throw new Error(tx('订单号不能为空', 'ORDER is required'));
        if (!form.customerId) throw new Error(tx('客户不能为空', 'CUSTOMER is required'));
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
        setMessage(result.message || tx('订单已创建', 'Order created'));
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
        setMessage(result.message || tx('订单已更新', 'Order updated'));
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
          <h2 className="text-2xl font-bold">{tx('订单管理', 'Orders')}</h2>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          {tx('新增订单', 'New Order')}
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
              placeholder={tx('搜索订单号 / 客户 / 备注', 'Search ORDER / customer / note')}
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={tx('状态', 'Status')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{tx('全部状态', 'All status')}</SelectItem>
                {statusOptions.map((status) => (
                  <SelectItem key={status} value={status}>{statusLabel(status)}</SelectItem>
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
                  <TableHead>{tx('订单号', 'ORDER')}</TableHead>
                  <TableHead>{tx('状态', 'STATUS')}</TableHead>
                  <TableHead>{tx('PI状态', 'PI STATUS')}</TableHead>
                  <TableHead>{tx('备注', 'REMARK')}</TableHead>
                  <TableHead>{tx('系统备注', 'SYSTEM NOTED')}</TableHead>
                  <TableHead>{tx('定金', 'DEPOSIT')}</TableHead>
                  <TableHead>{tx('客户', 'Customer')}</TableHead>
                  <TableHead>{tx('操作', 'Actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-semibold">{formatOrderNameDisplay(row.orderNo)}</TableCell>
                    <TableCell><Badge variant={statusBadgeVariant(row.status)}>{statusLabel(row.status)}</Badge></TableCell>
                    <TableCell>
                      {row.piStatus ? (
                        <Badge variant="default" className="gap-1"><CheckSquare className="h-3 w-3" />PI</Badge>
                      ) : '-'}
                    </TableCell>
                    <TableCell className="min-w-[220px] whitespace-pre-wrap">{row.remark || '-'}</TableCell>
                    <TableCell className="min-w-[220px] whitespace-pre-wrap">{row.systemNote || '-'}</TableCell>
                    <TableCell className="font-medium">{row.depositAmount ? formatUsdAmount(row.depositAmount) : '-'}</TableCell>
                    <TableCell>
                      <div className="max-w-[180px] truncate text-sm font-medium" title={row.customerMark || '-'}>{row.customerMark || '-'}</div>
                      <div className="max-w-[180px] truncate text-xs text-muted-foreground" title={row.customerName || row.customerPhone || '-'}>{row.customerName || row.customerPhone || '-'}</div>
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
                      {loading ? tx('加载中...', 'Loading...') : tx('暂无订单记录', 'No Orders records')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] overflow-x-hidden overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{dialogMode === 'create' ? tx('新增订单', 'New Order') : tx('修改订单', 'Edit Order')}</DialogTitle>
            <DialogDescription className={dialogMode === 'create' ? 'sr-only' : undefined}>
              {dialogMode === 'create'
                ? tx('创建订单记录', 'Create order record')
                : tx('基础字段由可见范围内账号修改；PI状态和系统备注仅上级管理员可修改。', 'Base fields are editable within the visible scope; PI status and system note require an upper ADMIN.')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>{tx('订单号', 'ORDER')}</Label>
              <Input
                value={form.orderNo}
                onChange={(event) => handleOrderNoChange(event.target.value)}
                disabled={dialogMode === 'edit'}
                placeholder="PIKIN-23"
              />
              {dialogMode === 'create' && (customerLookupLoading || customerLookupHint) && (
                <p className="text-xs text-muted-foreground">
                  {customerLookupLoading ? tx('正在匹配客户...', 'Matching customer...') : customerLookupHint}
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label>{tx('客户', 'Customer')}</Label>
              <Select
                value={form.customerId}
                onValueChange={(value) => setForm((prev) => ({ ...prev, customerId: value }))}
                disabled={dialogMode === 'edit'}
              >
                <SelectTrigger data-testid="orders-customer-select-trigger" className="w-full min-w-0 overflow-hidden [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate">
                  <SelectValue placeholder={tx('选择客户', 'Select customer')} />
                </SelectTrigger>
                <SelectContent className="max-w-[calc(100vw-3rem)] sm:max-w-[40rem]">
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id} className="max-w-full overflow-hidden">
                      <span
                        className="block max-w-[min(34rem,calc(100vw-6rem))] truncate"
                        data-testid={`orders-customer-option-${customer.id}`}
                        title={customerOptionLabel(customer)}
                      >
                        {customerOptionLabel(customer)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedCustomer && (
                <div className="min-w-0 space-y-1 text-xs text-muted-foreground">
                  <p className="truncate" title={selectedCustomerLabel}>{selectedCustomerLabel}</p>
                  <p className="truncate" title={`${selectedCustomer.phone} · ${selectedCustomer.city}`}>
                    {selectedCustomer.phone} · {selectedCustomer.city}
                  </p>
                </div>
              )}
            </div>

            <div className="grid gap-2">
              <Label>{tx('状态', 'Status')}</Label>
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
                    <SelectItem key={status} value={status}>{statusLabel(status)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>{tx('备注', 'Remark')}</Label>
                <span className="text-xs text-muted-foreground">{form.remark.length}/{MAX_REMARK_LENGTH}</span>
              </div>
              <Textarea
                value={form.remark}
                onChange={(event) => setForm((prev) => ({ ...prev, remark: event.target.value.slice(0, MAX_REMARK_LENGTH) }))}
                disabled={dialogMode === 'edit' && !editingOrder?.canEdit}
                rows={3}
              />
            </div>

            {dialogMode === 'edit' && (
              <>
                <div className="flex items-center gap-3 rounded-md border p-3">
                  <Checkbox
                    checked={form.piStatus}
                    onCheckedChange={(checked) => setForm((prev) => ({ ...prev, piStatus: checked === true }))}
                    disabled={!editingOrder?.canEditAdminFields}
                    id="orders-pi-status"
                  />
                  <Label htmlFor="orders-pi-status" className="cursor-pointer">{tx('PI状态', 'PI STATUS')}</Label>
                </div>

                <div className="grid gap-2">
                  <Label>{tx('系统备注', 'SYSTEM NOTED')}</Label>
                  <Textarea
                    value={form.systemNote}
                    onChange={(event) => setForm((prev) => ({ ...prev, systemNote: event.target.value }))}
                    disabled={!editingOrder?.canEditAdminFields}
                    rows={3}
                  />
                </div>
              </>
            )}
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
