'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/workspace/modules/shared/money-input';
import { formatOrderNameDisplay } from '@/lib/display-format';
import { Loader2, Plus, X } from 'lucide-react';
import type { InvoiceDraftOrder } from '../types';

export type CreateInvoiceDialogProps = {
  open: boolean;
  submitting: boolean;
  formError: string;
  invNo: string;
  shipDate: string;
  releaseDate: string;
  orders: InvoiceDraftOrder[];
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  onInvNoChange: (value: string) => void;
  onShipDateChange: (value: string) => void;
  onReleaseDateChange: (value: string) => void;
  onOrderChange: (index: number, field: 'orderNo' | 'amount' | 'customerMark', value: string) => void;
  onOrderCustomerSelect: (index: number, customerId: string) => void;
  onAddOrderRow: () => void;
  onRemoveOrder: (index: number) => void;
  onSubmit: () => void;
};

export function CreateInvoiceDialog({
  open,
  submitting,
  formError,
  invNo,
  shipDate,
  releaseDate,
  orders,
  tx,
  onOpenChange,
  onInvNoChange,
  onShipDateChange,
  onReleaseDateChange,
  onOrderChange,
  onOrderCustomerSelect,
  onAddOrderRow,
  onRemoveOrder,
  onSubmit,
}: CreateInvoiceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-24px)] max-w-2xl flex-col overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>{tx('创建账单', 'Create Invoice')}</DialogTitle>
          <DialogDescription>{tx('创建新账单并添加订单', 'Create a new invoice and add orders')}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label>{tx('账单号 (INV NO)', 'Invoice No. (INV NO)')}</Label>
            <Input value={invNo} onChange={(e) => onInvNoChange(e.target.value)} placeholder={tx('如: L25MH090125', 'e.g. L25MH090125')} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{tx('发货日期 (SHIP_DATE)', 'SHIP_DATE')}</Label>
              <Input type="date" value={shipDate} onChange={(e) => onShipDateChange(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{tx('放货日期 (RELEASE_DATE)', 'RELEASE_DATE')}</Label>
              <Input type="date" value={releaseDate} onChange={(e) => onReleaseDateChange(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{tx('订单列表', 'Order List')}</Label>
            {orders.map((order, index) => (
              <div key={index} className="space-y-2 border rounded-md p-2">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    placeholder={tx('客户单号 (ORDER)', 'Order No. (ORDER)')}
                    value={order.orderNo}
                    onChange={(e) => onOrderChange(index, 'orderNo', e.target.value)}
                    className="flex-1"
                  />
                  <MoneyInput
                    placeholder={tx('金额 (AMOUNT)', 'Amount (AMOUNT)')}
                    value={order.amount}
                    onValueChange={(value) => onOrderChange(index, 'amount', value)}
                    className="sm:w-32"
                  />
                  <Input
                    placeholder={tx('客户MARK(必填)', 'Customer MARK (required)')}
                    value={order.customerMark}
                    onChange={(e) => onOrderChange(index, 'customerMark', e.target.value)}
                    className="sm:w-44"
                  />
                  {orders.length > 1 && (
                    <Button variant="ghost" size="icon" onClick={() => onRemoveOrder(index)}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {order.customerCandidates.length > 1 && (
                  <select
                    className="w-full border rounded-md px-3 py-2 text-sm"
                    value={order.customerId}
                    onChange={(e) => onOrderCustomerSelect(index, e.target.value)}
                  >
                    <option value="">{tx('请选择准确客户(MARK+ORDER_NAME)', 'Please select exact customer (MARK+ORDER_NAME)')}</option>
                    {order.customerCandidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>{candidate.mark} / {formatOrderNameDisplay(candidate.orderName)}</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        </div>
        <div data-testid="invoice-create-footer-actions" className="border-t bg-background p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="outline" onClick={onAddOrderRow} className="w-full sm:w-auto">
              <Plus className="h-4 w-4 mr-2" /> {tx('添加订单', 'Add Order')}
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>{tx('取消', 'Cancel')}</Button>
              <Button onClick={onSubmit} disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {tx('创建', 'Create')}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
