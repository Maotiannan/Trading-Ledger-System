'use client';

import type { CustomerCandidate } from '@/components/workspace/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Check } from 'lucide-react';
import type { ReceiptDirectForm } from '../types';

export type ReceiptDirectCreateDialogProps = {
  open: boolean;
  locale: string;
  form: ReceiptDirectForm;
  customerCandidates: CustomerCandidate[];
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  onFormChange: (value: ReceiptDirectForm) => void;
  onCustomerMarkChange: (value: string) => void;
  onCustomerSelect: (customerId: string) => void;
  onSubmit: () => void;
};

export function ReceiptDirectCreateDialog({
  open,
  locale,
  form,
  customerCandidates,
  tx,
  onOpenChange,
  onFormChange,
  onCustomerMarkChange,
  onCustomerSelect,
  onSubmit,
}: ReceiptDirectCreateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tx('直接创建收据', 'Create Receipt Directly')}</DialogTitle>
          <DialogDescription>{tx('跳过AI识别，手动录入收据信息', 'Skip AI and enter receipt information manually')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Input placeholder={tx('客户MARK(必填)', 'Customer MARK (required)')} value={form.customerMark} onChange={(e) => onCustomerMarkChange(e.target.value)} />
          {customerCandidates.length > 1 && (
            <select className="w-full border rounded-md px-3 py-2 text-sm" value={form.customerId} onChange={(e) => onCustomerSelect(e.target.value)}>
              <option value="">{tx('请选择准确客户(MARK+ORDER_NAME)', 'Please select exact customer (MARK+ORDER_NAME)')}</option>
              {customerCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.mark} / {candidate.orderName}</option>
              ))}
            </select>
          )}
          <Input placeholder={tx('收据号', 'Receipt No.')} value={form.receiptNo} onChange={(e) => onFormChange({ ...form, receiptNo: e.target.value })} />
          <Input type="date" lang={locale === 'en' ? 'en-CA' : 'zh-CN'} placeholder={tx('日期', 'Date')} value={form.date} onChange={(e) => onFormChange({ ...form, date: e.target.value })} />
          <Input placeholder={tx('电话', 'Phone')} value={form.tel} onChange={(e) => onFormChange({ ...form, tel: e.target.value })} />
          <Input type="number" placeholder={tx('付款金额(USD)', 'Amount (USD)')} value={form.usd} onChange={(e) => onFormChange({ ...form, usd: e.target.value })} />
          <Input placeholder={tx('账单号(invNo)', 'Invoice No. (invNo)')} value={form.invNo} onChange={(e) => onFormChange({ ...form, invNo: e.target.value })} />
          <Input placeholder={tx('客户单号(orderNo)', 'Order No. (orderNo)')} value={form.orderNo} onChange={(e) => onFormChange({ ...form, orderNo: e.target.value })} />
          <Input placeholder={tx('付款人', 'Payer')} value={form.payer} onChange={(e) => onFormChange({ ...form, payer: e.target.value })} />
          <Label className="flex items-center gap-2">
            <input type="checkbox" checked={form.isDeposit} onChange={(e) => onFormChange({ ...form, isDeposit: e.target.checked })} />
            {tx('定金', 'Deposit')}
          </Label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tx('取消', 'Cancel')}</Button>
          <Button onClick={onSubmit}>
            <Check className="h-4 w-4 mr-2" />
            {tx('创建', 'Create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
