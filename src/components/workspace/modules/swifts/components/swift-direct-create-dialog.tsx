'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/workspace/modules/shared/money-input';
import { formatUsdAmount } from '@/lib/display-format';
import { Check } from 'lucide-react';
import type { SwiftDetailOption, SwiftDirectForm } from '../types';

export type SwiftDirectCreateDialogProps = {
  open: boolean;
  waitingDetails: SwiftDetailOption[];
  waitingDetailsLoading: boolean;
  form: SwiftDirectForm;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  onFormChange: (updater: (prev: SwiftDirectForm) => SwiftDirectForm) => void;
  onSubmit: () => void;
};

export function SwiftDirectCreateDialog({ open, waitingDetails, waitingDetailsLoading, form, tx, onOpenChange, onFormChange, onSubmit }: SwiftDirectCreateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] p-0 overflow-hidden max-h-[90vh] sm:max-w-2xl">
        <div className="flex max-h-[90vh] flex-col">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle>{tx('直接创建SWIFT', 'Create SWIFT Directly')}</DialogTitle>
            <DialogDescription>{tx('跳过AI识别，手动录入SWIFT信息', 'Skip AI and enter SWIFT information manually')}</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="space-y-3">
              <div>
                <Label>{tx('关联付款明细', 'Linked Payment Detail')}</Label>
                <select
                  className="w-full mt-1 border rounded-md p-2"
                  value={form.detailId}
                  onChange={(e) => onFormChange((prev) => ({ ...prev, detailId: e.target.value }))}
                >
                  <option value="">{waitingDetailsLoading ? tx('加载中...', 'Loading...') : tx('请选择...', 'Please select...')}</option>
                  {waitingDetails.map((detail) => (
                    <option key={detail.id} value={detail.id}>
                      {detail.date ? new Date(detail.date).toLocaleDateString() : tx('日期未知', 'Unknown date')} - {formatUsdAmount(detail.totalAmount)}
                    </option>
                  ))}
                </select>
              </div>
              <MoneyInput placeholder={tx('汇款金额', 'Amount')} value={form.amount} onValueChange={(value) => onFormChange((prev) => ({ ...prev, amount: value }))} />
              <Input type="date" placeholder={tx('汇款日期', 'Transfer Date')} value={form.date} onChange={(e) => onFormChange((prev) => ({ ...prev, date: e.target.value }))} />
              <Input placeholder={tx('付款人姓名', 'Sender Name')} value={form.senderName} onChange={(e) => onFormChange((prev) => ({ ...prev, senderName: e.target.value }))} />
              <Input placeholder={tx('付款人地址', 'Sender Address')} value={form.senderAddress} onChange={(e) => onFormChange((prev) => ({ ...prev, senderAddress: e.target.value }))} />
              <Input placeholder={tx('收款人姓名', 'Receiver Name')} value={form.receiverName} onChange={(e) => onFormChange((prev) => ({ ...prev, receiverName: e.target.value }))} />
              <Input placeholder={tx('收款账号', 'Receiver Account')} value={form.receiverAccount} onChange={(e) => onFormChange((prev) => ({ ...prev, receiverAccount: e.target.value }))} />
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t px-6 py-4 flex-col-reverse gap-2 sm:flex-row sm:gap-0">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{tx('取消', 'Cancel')}</Button>
            <Button onClick={onSubmit} disabled={waitingDetailsLoading}>
              <Check className="h-4 w-4 mr-2" />
              {tx('创建', 'Create')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
