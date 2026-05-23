'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/workspace/modules/shared/money-input';
import { formatUsdAmount } from '@/lib/display-format';
import { Check, Plus } from 'lucide-react';
import type { DetailDirectItemForm, DetailDirectSelectableReceipt } from '../types';

export type DetailDirectCreateDialogProps = {
  open: boolean;
  locale: string;
  directDate: string;
  directItems: DetailDirectItemForm[];
  selectableReceipts: DetailDirectSelectableReceipt[];
  selectedReceiptIds: string[];
  selectableReceiptsLoading: boolean;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  onDirectDateChange: (value: string) => void;
  onDirectItemsChange: (items: DetailDirectItemForm[]) => void;
  onSelectedReceiptIdsChange: (ids: string[]) => void;
  onSubmit: () => void;
};

export function DetailDirectCreateDialog({
  open,
  locale,
  directDate,
  directItems,
  selectableReceipts,
  selectedReceiptIds,
  selectableReceiptsLoading,
  tx,
  onOpenChange,
  onDirectDateChange,
  onDirectItemsChange,
  onSelectedReceiptIdsChange,
  onSubmit,
}: DetailDirectCreateDialogProps) {
  const [receiptSearch, setReceiptSearch] = useState('');
  const selectedReceiptIdSet = useMemo(() => new Set(selectedReceiptIds), [selectedReceiptIds]);
  const visibleReceipts = useMemo(() => {
    const keyword = receiptSearch.trim().toLowerCase();
    if (!keyword) return selectableReceipts;
    return selectableReceipts.filter((receipt) => {
      const haystack = [
        receipt.receiptNo,
        receipt.order?.orderNo,
        receipt.orderNo,
        receipt.order?.customerMark,
        receipt.customerMark,
        receipt.payer,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(keyword);
    });
  }, [receiptSearch, selectableReceipts]);

  const toggleReceipt = (receiptId: string) => {
    if (selectedReceiptIdSet.has(receiptId)) {
      onSelectedReceiptIdsChange(selectedReceiptIds.filter((id) => id !== receiptId));
      return;
    }
    onSelectedReceiptIdsChange([...selectedReceiptIds, receiptId]);
  };

  const getReceiptOrderNo = (receipt: DetailDirectSelectableReceipt) => receipt.order?.orderNo || receipt.orderNo || '-';
  const getReceiptMark = (receipt: DetailDirectSelectableReceipt) => receipt.order?.customerMark || receipt.customerMark || '-';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-hidden p-4 sm:max-w-5xl sm:p-6">
        <DialogHeader>
          <DialogTitle>{tx('直接创建付款明细', 'Create Payment Detail Directly')}</DialogTitle>
          <DialogDescription>
            {tx('可勾选已收到的收据，也可以继续手动录入新明细行', 'Select received receipts or keep entering new detail rows manually')}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto py-2 pr-1">
          <Input type="date" lang={locale === 'en' ? 'en-CA' : 'zh-CN'} value={directDate} onChange={(e) => onDirectDateChange(e.target.value)} />
          <section className="rounded-lg border p-3">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium">{tx('可加入的收据', 'Receipts available to add')}</div>
                <div className="text-xs text-muted-foreground">
                  {tx(`已选择 ${selectedReceiptIds.length} 条`, `${selectedReceiptIds.length} selected`)}
                </div>
              </div>
              <Input
                className="sm:max-w-xs"
                placeholder={tx('搜索收据号/单号/唛头/付款人', 'Search receipt/order/mark/payer')}
                value={receiptSearch}
                onChange={(event) => setReceiptSearch(event.target.value)}
              />
            </div>
            <div
              data-testid="direct-create-receipt-options"
              className="max-h-72 space-y-2 overflow-y-auto rounded-md border bg-muted/20 p-2"
            >
              {selectableReceiptsLoading ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {tx('正在加载可加入收据...', 'Loading available receipts...')}
                </div>
              ) : visibleReceipts.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {tx('暂无可加入的 SR_Received 收据', 'No SR_Received receipts available')}
                </div>
              ) : visibleReceipts.map((receipt) => {
                const checked = selectedReceiptIdSet.has(receipt.id);
                const receiptLabel = receipt.receiptNo || receipt.id;
                return (
                  <label
                    key={receipt.id}
                    className="grid cursor-pointer gap-2 rounded-md border bg-background p-3 text-sm shadow-xs sm:grid-cols-[auto_1.2fr_1fr_1fr_1fr] sm:items-center"
                  >
                    <input
                      type="checkbox"
                      aria-label={tx(`选择收据 ${receiptLabel}`, `Select receipt ${receiptLabel}`)}
                      checked={checked}
                      onChange={() => toggleReceipt(receipt.id)}
                    />
                    <div className="min-w-0">
                      <div className="font-medium">{receipt.receiptNo || '-'}</div>
                      <div className="text-xs text-muted-foreground">{receipt.date || '-'}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">{tx('单号', 'Order')}</div>
                      <div className="truncate font-medium">{getReceiptOrderNo(receipt)}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">{tx('唛头', 'Mark')}</div>
                      <div className="truncate">{getReceiptMark(receipt)}</div>
                    </div>
                    <div className="min-w-0 sm:text-right">
                      <div className="font-semibold">{formatUsdAmount(receipt.usd)}</div>
                      <div className="truncate text-xs text-muted-foreground">{receipt.payer || '-'}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </section>
          <section className="space-y-3 rounded-lg border p-3">
            <div className="font-medium">{tx('手动新增明细行', 'Manual detail rows')}</div>
          {directItems.map((item, index) => (
            <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
          <Button className="w-full sm:w-auto" variant="outline" onClick={() => onDirectItemsChange([...directItems, { mark: '', orderNo: '', amount: '' }])}>
            <Plus className="h-4 w-4 mr-2" />
            {tx('增加明细行', 'Add Detail Row')}
          </Button>
          </section>
        </div>
        <DialogFooter className="border-t pt-3">
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
