'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { ReceiptEditablePatch } from '@/lib/receipt-edit-types';

export type ReceiptEditSuggestion = Partial<ReceiptEditablePatch>;

export type ReceiptEditDialogProps = {
  open: boolean;
  locale: string;
  form: ReceiptEditablePatch;
  suggestion: ReceiptEditSuggestion | null;
  suggestionLoading: boolean;
  submitting: boolean;
  isAdmin: boolean;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  onFormChange: (value: ReceiptEditablePatch) => void;
  onAdoptSuggestion: () => void;
  onSubmit: () => void;
};

export function ReceiptEditDialog({
  open,
  locale,
  form,
  suggestion,
  suggestionLoading,
  submitting,
  isAdmin,
  tx,
  onOpenChange,
  onFormChange,
  onAdoptSuggestion,
  onSubmit,
}: ReceiptEditDialogProps) {
  const suggestionRows = suggestion
    ? [
        ['ORDER NO', suggestion.orderNo],
        ['INV NO', suggestion.invNo],
        ['MARK', suggestion.customerMark],
        [tx('付款人', 'Payer'), suggestion.payer],
        [tx('电话', 'Phone'), suggestion.tel],
      ].filter((row): row is [string, string] => typeof row[1] === 'string' && row[1].trim().length > 0)
    : [];

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
            placeholder={tx('客户单号(orderNo)', 'Order No. (orderNo)')}
            value={form.orderNo ?? ''}
            onChange={(e) => onFormChange({ ...form, orderNo: e.target.value || null })}
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
          {(suggestionLoading || suggestionRows.length > 0) && (
            <div className="rounded-md border bg-amber-50 p-3 text-sm text-amber-950">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="font-medium">
                  {suggestionLoading
                    ? tx('正在匹配订单信息...', 'Matching order information...')
                    : tx('发现可采纳的匹配建议', 'Matching suggestions found')}
                </div>
                {suggestionRows.length > 0 && (
                  <Button type="button" size="sm" variant="outline" onClick={onAdoptSuggestion} disabled={submitting}>
                    {tx('采纳匹配建议', 'Adopt Suggestion')}
                  </Button>
                )}
              </div>
              {suggestionRows.length > 0 && (
                <div className="grid gap-1">
                  {suggestionRows.map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-3">
                      <span className="text-amber-700">{label}</span>
                      <span className="text-right font-medium">{value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
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
