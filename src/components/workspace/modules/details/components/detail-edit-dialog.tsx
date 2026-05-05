'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { DetailEditablePatch } from '@/lib/detail-edit-types';

export type DetailEditDialogProps = {
  open: boolean;
  locale: string;
  form: DetailEditablePatch;
  submitting: boolean;
  isAdmin: boolean;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  onFormChange: (value: DetailEditablePatch) => void;
  onSubmit: () => void;
};

export function DetailEditDialog({
  open,
  locale,
  form,
  submitting,
  isAdmin,
  tx,
  onOpenChange,
  onFormChange,
  onSubmit,
}: DetailEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{tx('修改付款明细', 'Edit Payment Detail')}</DialogTitle>
          <DialogDescription>
            {isAdmin
              ? tx('管理员提交后会直接生效', 'Admin changes apply immediately after submission.')
              : tx('销售提交后需等待管理员审批', 'Sales changes require administrator approval.')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <Input
            type="date"
            lang={locale === 'en' ? 'en-CA' : 'zh-CN'}
            placeholder={tx('付款日期', 'Payment Date')}
            value={form.date ?? ''}
            onChange={(e) => onFormChange({ ...form, date: e.target.value || null })}
          />
          <div className="space-y-3">
            {form.items.map((item, index) => (
              <div key={`${index}-${item.orderNo ?? 'item'}`} className="grid grid-cols-1 gap-3 rounded-md border p-3 md:grid-cols-4">
                <Input
                  placeholder={tx('客户MARK', 'Customer MARK')}
                  value={item.mark ?? ''}
                  onChange={(e) => {
                    const nextItems = form.items.map((current, currentIndex) => currentIndex === index
                      ? { ...current, mark: e.target.value || null }
                      : current);
                    onFormChange({ ...form, items: nextItems });
                  }}
                />
                <Input
                  placeholder={tx('单号', 'Order No.')}
                  value={item.orderNo ?? ''}
                  onChange={(e) => {
                    const nextItems = form.items.map((current, currentIndex) => currentIndex === index
                      ? { ...current, orderNo: e.target.value || null }
                      : current);
                    onFormChange({ ...form, items: nextItems });
                  }}
                />
                <Input
                  type="number"
                  step="0.01"
                  placeholder={tx('金额', 'Amount')}
                  value={Number.isFinite(item.amount) ? String(item.amount) : ''}
                  onChange={(e) => {
                    const nextAmount = Number(e.target.value);
                    const nextItems = form.items.map((current, currentIndex) => currentIndex === index
                      ? { ...current, amount: Number.isFinite(nextAmount) ? nextAmount : 0 }
                      : current);
                    onFormChange({ ...form, items: nextItems });
                  }}
                />
                <Input
                  placeholder={tx('关联收据ID', 'Linked Receipt ID')}
                  value={item.receiptId ?? ''}
                  onChange={(e) => {
                    const nextItems = form.items.map((current, currentIndex) => currentIndex === index
                      ? { ...current, receiptId: e.target.value || null }
                      : current);
                    onFormChange({ ...form, items: nextItems });
                  }}
                />
              </div>
            ))}
          </div>
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
