'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { DetailEditablePatch } from '@/lib/detail-edit-types';

export type DetailEditDialogProps = {
  open: boolean;
  locale: string;
  form: DetailEditablePatch;
  linkedReceiptLabels: string[];
  submitting: boolean;
  isAdmin: boolean;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  onFormChange: (value: DetailEditablePatch) => void;
  onItemChange: (index: number, patch: { mark?: string | null; orderNo?: string | null; amount?: number }) => void;
  onSubmit: () => void;
};

export function DetailEditDialog({
  open,
  locale,
  form,
  linkedReceiptLabels,
  submitting,
  isAdmin,
  tx,
  onOpenChange,
  onFormChange,
  onItemChange,
  onSubmit,
}: DetailEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] p-0 overflow-hidden max-h-[90vh] sm:max-w-3xl">
        <div className="flex max-h-[90vh] flex-col">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle>{tx('修改付款明细', 'Edit Payment Detail')}</DialogTitle>
            <DialogDescription>
              {isAdmin
                ? tx('管理员提交后会直接生效', 'Admin changes apply immediately after submission.')
                : tx('销售提交后需等待管理员审批', 'Sales changes require administrator approval.')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="space-y-4">
              <Input
                type="date"
                lang={locale === 'en' ? 'en-CA' : 'zh-CN'}
                placeholder={tx('付款日期', 'Payment Date')}
                value={form.date ?? ''}
                onChange={(e) => onFormChange({ ...form, date: e.target.value || null })}
              />
              <div className="space-y-3">
                {form.items.map((item, index) => (
                  <div key={index} className="grid grid-cols-1 gap-3 rounded-md border p-3 md:grid-cols-4">
                    <Input
                      placeholder={tx('客户MARK', 'Customer MARK')}
                      value={item.mark ?? ''}
                      onChange={(e) => onItemChange(index, { mark: e.target.value || null })}
                    />
                    <Input
                      placeholder={tx('单号', 'Order No.')}
                      value={item.orderNo ?? ''}
                      onChange={(e) => onItemChange(index, { orderNo: e.target.value || null })}
                    />
                    <Input
                      type="number"
                      step="0.01"
                      placeholder={tx('金额', 'Amount')}
                      value={Number.isFinite(item.amount) ? String(item.amount) : ''}
                      onChange={(e) => {
                        const nextAmount = Number(e.target.value);
                        onItemChange(index, { amount: Number.isFinite(nextAmount) ? nextAmount : 0 });
                      }}
                    />
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">{tx('关联收据', 'Linked Receipt')}</div>
                      <div className="min-h-10 rounded-md border px-3 py-2 text-sm">
                        {linkedReceiptLabels[index] || tx('未匹配', 'Unmatched')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t px-6 py-4 flex-col-reverse gap-2 sm:flex-row sm:gap-0">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              {tx('取消', 'Cancel')}
            </Button>
            <Button onClick={onSubmit} disabled={submitting}>
              {isAdmin ? tx('保存修改', 'Save Changes') : tx('提交审批', 'Submit for Approval')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
