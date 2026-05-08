'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/workspace/modules/shared/money-input';
import { Check, Plus } from 'lucide-react';
import type { DetailDirectItemForm } from '../types';

export type DetailDirectCreateDialogProps = {
  open: boolean;
  locale: string;
  directDate: string;
  directItems: DetailDirectItemForm[];
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  onDirectDateChange: (value: string) => void;
  onDirectItemsChange: (items: DetailDirectItemForm[]) => void;
  onSubmit: () => void;
};

export function DetailDirectCreateDialog({ open, locale, directDate, directItems, tx, onOpenChange, onDirectDateChange, onDirectItemsChange, onSubmit }: DetailDirectCreateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tx('直接创建付款明细', 'Create Payment Detail Directly')}</DialogTitle>
          <DialogDescription>{tx('跳过AI识别，手动录入明细行', 'Skip AI and enter detail rows manually')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Input type="date" lang={locale === 'en' ? 'en-CA' : 'zh-CN'} value={directDate} onChange={(e) => onDirectDateChange(e.target.value)} />
          {directItems.map((item, index) => (
            <div key={index} className="grid grid-cols-3 gap-2">
              <Input
                placeholder={tx('唛头', 'Mark')}
                value={item.mark}
                onChange={(e) => onDirectItemsChange(directItems.map((row, idx) => (idx === index ? { ...row, mark: e.target.value } : row)))}
              />
              <Input
                placeholder={tx('单号', 'Order No.')}
                value={item.orderNo}
                onChange={(e) => onDirectItemsChange(directItems.map((row, idx) => (idx === index ? { ...row, orderNo: e.target.value } : row)))}
              />
              <MoneyInput
                placeholder={tx('金额', 'Amount')}
                value={item.amount}
                onValueChange={(value) => onDirectItemsChange(directItems.map((row, idx) => (idx === index ? { ...row, amount: value } : row)))}
              />
            </div>
          ))}
          <Button variant="outline" onClick={() => onDirectItemsChange([...directItems, { mark: '', orderNo: '', amount: '' }])}>
            <Plus className="h-4 w-4 mr-2" />
            {tx('增加明细行', 'Add Detail Row')}
          </Button>
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
