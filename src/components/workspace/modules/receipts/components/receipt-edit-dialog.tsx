'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { ReceiptEditablePatch } from '@/lib/receipt-edit-types';

export type ReceiptEditDialogProps = {
  open: boolean;
  locale: string;
  form: ReceiptEditablePatch;
  submitting: boolean;
  isAdmin: boolean;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  onFormChange: (value: ReceiptEditablePatch) => void;
  onSubmit: () => void;
};

export function ReceiptEditDialog({
  open,
  locale,
  form,
  submitting,
  isAdmin,
  tx,
  onOpenChange,
  onFormChange,
  onSubmit,
}: ReceiptEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tx('修改收据', 'Edit Receipt')}</DialogTitle>
          <DialogDescription>
            {isAdmin
              ? tx('管理员提交后会直接生效', 'Admin changes apply immediately after submission.')
              : tx('销售提交后需等待管理员审批', 'Sales changes require administrator approval.')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Input
            placeholder={tx('收据号', 'Receipt No.')}
            value={form.receiptNo ?? ''}
            onChange={(e) => onFormChange({ ...form, receiptNo: e.target.value || null })}
          />
          <Input
            type="date"
            lang={locale === 'en' ? 'en-CA' : 'zh-CN'}
            placeholder={tx('付款日期', 'Payment Date')}
            value={form.date ?? ''}
            onChange={(e) => onFormChange({ ...form, date: e.target.value || null })}
          />
          <Input
            placeholder={tx('账单号(invNo)', 'Invoice No. (invNo)')}
            value={form.invNo ?? ''}
            onChange={(e) => onFormChange({ ...form, invNo: e.target.value || null })}
          />
          <Input
            placeholder={tx('客户MARK', 'Customer MARK')}
            value={form.customerMark ?? ''}
            onChange={(e) => onFormChange({ ...form, customerMark: e.target.value || null })}
          />
          <Input
            placeholder={tx('付款人', 'Payer')}
            value={form.payer ?? ''}
            onChange={(e) => onFormChange({ ...form, payer: e.target.value || null })}
          />
          <Input
            placeholder={tx('电话', 'Phone')}
            value={form.tel ?? ''}
            onChange={(e) => onFormChange({ ...form, tel: e.target.value || null })}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {tx('取消', 'Cancel')}
          </Button>
          <Button onClick={onSubmit} disabled={submitting}>
            {isAdmin ? tx('保存修改', 'Save Changes') : tx('提交审批', 'Submit for Approval')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
