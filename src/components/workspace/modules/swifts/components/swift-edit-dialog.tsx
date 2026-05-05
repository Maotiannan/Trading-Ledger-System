'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { SwiftEditablePatch } from '@/lib/swift-edit-types';

export type SwiftEditDialogProps = {
  open: boolean;
  locale: string;
  form: SwiftEditablePatch;
  submitting: boolean;
  isAdmin: boolean;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  onFormChange: (value: SwiftEditablePatch) => void;
  onSubmit: () => void;
};

export function SwiftEditDialog({
  open,
  locale,
  form,
  submitting,
  isAdmin,
  tx,
  onOpenChange,
  onFormChange,
  onSubmit,
}: SwiftEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tx('修改SWIFT', 'Edit SWIFT')}</DialogTitle>
          <DialogDescription>
            {isAdmin
              ? tx('管理员提交后会直接生效', 'Admin changes apply immediately after submission.')
              : tx('销售提交后需等待管理员审批', 'Sales changes require administrator approval.')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 py-2 md:grid-cols-2">
          <Input
            type="date"
            lang={locale === 'en' ? 'en-CA' : 'zh-CN'}
            placeholder={tx('日期', 'Date')}
            value={form.date ?? ''}
            onChange={(e) => onFormChange({ ...form, date: e.target.value || null })}
          />
          <Input
            type="number"
            step="0.01"
            placeholder={tx('金额', 'Amount')}
            value={Number.isFinite(form.amount) ? String(form.amount) : ''}
            onChange={(e) => {
              const amount = Number(e.target.value);
              onFormChange({ ...form, amount: Number.isFinite(amount) ? amount : 0 });
            }}
          />
          <Input
            placeholder={tx('汇款人', 'Sender')}
            value={form.senderName ?? ''}
            onChange={(e) => onFormChange({ ...form, senderName: e.target.value || null })}
          />
          <Input
            placeholder={tx('汇款人地址', 'Sender Address')}
            value={form.senderAddress ?? ''}
            onChange={(e) => onFormChange({ ...form, senderAddress: e.target.value || null })}
          />
          <Input
            placeholder={tx('收款人', 'Receiver')}
            value={form.receiverName ?? ''}
            onChange={(e) => onFormChange({ ...form, receiverName: e.target.value || null })}
          />
          <Input
            placeholder={tx('收款账号', 'Receiver Account')}
            value={form.receiverAccount ?? ''}
            onChange={(e) => onFormChange({ ...form, receiverAccount: e.target.value || null })}
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
