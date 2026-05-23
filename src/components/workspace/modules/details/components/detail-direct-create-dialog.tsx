'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/workspace/modules/shared/money-input';
import { formatUsdAmount, parseDisplayMoney } from '@/lib/display-format';
import { Check, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import type { DetailDirectItemForm, DetailDirectSelectableReceipt, PaymentAgentSummary } from '../types';

export type DetailDirectCreateDialogProps = {
  open: boolean;
  locale: string;
  directDate: string;
  directItems: DetailDirectItemForm[];
  agents: PaymentAgentSummary[];
  agentsLoading: boolean;
  selectedAgentId: string;
  selectableReceipts: DetailDirectSelectableReceipt[];
  selectedReceiptIds: string[];
  selectableReceiptsLoading: boolean;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  onDirectDateChange: (value: string) => void;
  onDirectItemsChange: (items: DetailDirectItemForm[]) => void;
  onSelectedAgentIdChange: (agentId: string) => void;
  onSelectedReceiptIdsChange: (ids: string[]) => void;
  onSubmit: () => void;
};

export function DetailDirectCreateDialog({
  open,
  locale,
  directDate,
  directItems,
  agents,
  agentsLoading,
  selectedAgentId,
  selectableReceipts,
  selectedReceiptIds,
  selectableReceiptsLoading,
  tx,
  onOpenChange,
  onDirectDateChange,
  onDirectItemsChange,
  onSelectedAgentIdChange,
  onSelectedReceiptIdsChange,
  onSubmit,
}: DetailDirectCreateDialogProps) {
  const [receiptSearch, setReceiptSearch] = useState('');
  const [manualRowsOpen, setManualRowsOpen] = useState(false);
  const selectedReceiptIdSet = useMemo(() => new Set(selectedReceiptIds), [selectedReceiptIds]);
  const selectedReceiptTotal = useMemo(() => (
    selectableReceipts.reduce((sum, receipt) => (
      selectedReceiptIdSet.has(receipt.id) ? sum + (parseDisplayMoney(receipt.usd) || 0) : sum
    ), 0)
  ), [selectableReceipts, selectedReceiptIdSet]);
  const manualItemsTotal = useMemo(() => (
    directItems.reduce((sum, item) => sum + (parseDisplayMoney(item.amount) || 0), 0)
  ), [directItems]);
  const totalAmount = selectedReceiptTotal + manualItemsTotal;
  const visibleReceipts = useMemo(() => {
    const keyword = receiptSearch.trim().toLowerCase();
    if (!keyword) return selectableReceipts;
    return selectableReceipts.filter((receipt) => {
      const haystack = [
        receipt.order?.orderNo,
        receipt.orderNo,
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

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setManualRowsOpen(false);
    }
    onOpenChange(nextOpen);
  };

  const handleSubmit = () => {
    setManualRowsOpen(false);
    onSubmit();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b p-4 pr-10 sm:p-6 sm:pr-12">
          <DialogTitle>{tx('直接创建付款明细', 'Create Payment Detail Directly')}</DialogTitle>
          <DialogDescription>
            {tx('可勾选已收到的收据，也可以继续手动录入新明细行', 'Select received receipts or keep entering new detail rows manually')}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
          <Input type="date" lang={locale === 'en' ? 'en-CA' : 'zh-CN'} value={directDate} onChange={(e) => onDirectDateChange(e.target.value)} />
          <label className="block space-y-1 text-sm">
            <span className="font-medium">{tx('付款代理', 'Payment Agent')}</span>
            <select
              className="h-9 w-full rounded-md border bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={tx('付款代理', 'Payment Agent')}
              value={selectedAgentId}
              onChange={(event) => onSelectedAgentIdChange(event.target.value)}
              disabled={agentsLoading}
            >
              <option value="">
                {agentsLoading ? tx('代理加载中', 'Loading agents') : tx('请选择付款代理', 'Select payment agent')}
              </option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.companyName}
                </option>
              ))}
            </select>
          </label>
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
                placeholder={tx('搜索单号', 'Search order no.')}
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
                    className="grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md border bg-background p-3 text-sm shadow-xs"
                  >
                    <input
                      type="checkbox"
                      aria-label={tx(`选择收据 ${receiptLabel}`, `Select receipt ${receiptLabel}`)}
                      checked={checked}
                      onChange={() => toggleReceipt(receipt.id)}
                    />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{getReceiptOrderNo(receipt)}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{formatUsdAmount(receipt.usd)}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </section>
          <section className="space-y-3 rounded-lg border p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium">{tx('手动新增明细行', 'Manual detail rows')}</div>
                <div className="text-xs text-muted-foreground">
                  {tx('需要手动补录时再展开', 'Expand only when manual entry is needed')}
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setManualRowsOpen((value) => !value)}>
                {manualRowsOpen ? <ChevronDown className="mr-2 h-4 w-4" /> : <ChevronRight className="mr-2 h-4 w-4" />}
                {manualRowsOpen ? tx('收起手动明细', 'Collapse manual rows') : tx('展开手动明细', 'Expand manual rows')}
              </Button>
            </div>
            {manualRowsOpen && (
              <>
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
              </>
            )}
          </section>
        </div>
        <DialogFooter
          data-testid="direct-create-footer"
          className="sticky bottom-0 z-10 flex-col shrink-0 border-t bg-background/95 p-4 shadow-[0_-8px_16px_rgba(15,23,42,0.06)] backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:p-6"
        >
          <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm sm:min-w-64 sm:flex-col sm:items-start sm:justify-center">
            <span className="text-muted-foreground">{tx('总计', 'Total')}</span>
            <span data-testid="direct-create-total-amount" className="text-lg font-semibold text-foreground">
              {formatUsdAmount(totalAmount, '$0')}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row">
            <Button variant="outline" onClick={() => handleOpenChange(false)}>{tx('取消', 'Cancel')}</Button>
            <Button onClick={handleSubmit}>
              <Check className="h-4 w-4 mr-2" />
              {tx('创建', 'Create')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
