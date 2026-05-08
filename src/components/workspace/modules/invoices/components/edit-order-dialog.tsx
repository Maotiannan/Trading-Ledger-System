'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/workspace/modules/shared/money-input';
import { formatOrderNameDisplay } from '@/lib/display-format';
import { Loader2 } from 'lucide-react';
import type { CustomerCandidate } from '@/components/workspace/shared';
import type { EditingInvoiceOrder } from '../types';

export type EditOrderDialogProps = {
  open: boolean;
  submitting: boolean;
  error: string;
  order: EditingInvoiceOrder | null;
  candidates: CustomerCandidate[];
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  onOrderChange: (order: EditingInvoiceOrder | null) => void;
  onMarkChange: (mark: string) => void;
  onCandidateSelect: (customerId: string) => void;
  onSubmit: () => void;
};

export function EditOrderDialog({
  open,
  submitting,
  error,
  order,
  candidates,
  tx,
  onOpenChange,
  onOrderChange,
  onMarkChange,
  onCandidateSelect,
  onSubmit,
}: EditOrderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tx('编辑订单', 'Edit Order')}</DialogTitle>
          <DialogDescription>{tx('修改订单信息', 'Update order information')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label>{tx('客户单号 (ORDER)', 'Order No. (ORDER)')}</Label>
            <Input
              value={order?.orderNo || ''}
              onChange={(e) => order && onOrderChange({ ...order, orderNo: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>{tx('账单号 (INV NO)', 'Invoice No. (INV NO)')}</Label>
            <Input
              value={order?.invNo || ''}
              onChange={(e) => order && onOrderChange({ ...order, invNo: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>{tx('金额 (AMOUNT)', 'Amount (AMOUNT)')}</Label>
            <MoneyInput
              value={order?.amount || ''}
              onValueChange={(value) => order && onOrderChange({ ...order, amount: parseFloat(value) || 0 })}
            />
          </div>
          <div className="space-y-2">
            <Label>{tx('客户MARK', 'Customer MARK')}</Label>
            <Input value={order?.customerMark || ''} onChange={(e) => onMarkChange(e.target.value)} />
          </div>
          {candidates.length > 1 && (
            <div className="space-y-2">
              <Label>{tx('选择客户', 'Select Customer')}</Label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={order?.customerId || ''}
                onChange={(e) => onCandidateSelect(e.target.value)}
              >
                <option value="">{tx('请选择准确客户(MARK+ORDER_NAME)', 'Please select exact customer (MARK+ORDER_NAME)')}</option>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>{candidate.mark} / {formatOrderNameDisplay(candidate.orderName)}</option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-2">
            <Label>{tx('客户ORDER_NAME', 'Customer ORDER_NAME')}</Label>
            <Input value={order?.customerName || ''} onChange={(e) => order && onOrderChange({ ...order, customerName: e.target.value.toUpperCase() })} />
          </div>
          <div className="space-y-2">
            <Label>{tx('客户PHONE', 'Customer PHONE')}</Label>
            <Input value={order?.customerPhone || ''} onChange={(e) => order && onOrderChange({ ...order, customerPhone: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>{tx('客户CITY', 'Customer CITY')}</Label>
            <Input value={order?.customerCity || ''} onChange={(e) => order && onOrderChange({ ...order, customerCity: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>{tx('取消', 'Cancel')}</Button>
          <Button onClick={onSubmit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {tx('保存', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
