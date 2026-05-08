'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/workspace/modules/shared/money-input';
import { formatUsdAmount } from '@/lib/display-format';
import { Loader2 } from 'lucide-react';
import type { TransferFromOrder } from '../types';

export type TransferBalanceDialogProps = {
  open: boolean;
  submitting: boolean;
  error: string;
  transferFromOrder: TransferFromOrder | null;
  transferToOrderNo: string;
  transferAmount: string;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  onTransferToOrderNoChange: (value: string) => void;
  onTransferAmountChange: (value: string) => void;
  onSubmit: () => void;
};

export function TransferBalanceDialog({
  open,
  submitting,
  error,
  transferFromOrder,
  transferToOrderNo,
  transferAmount,
  tx,
  onOpenChange,
  onTransferToOrderNoChange,
  onTransferAmountChange,
  onSubmit,
}: TransferBalanceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tx('转移多付余额', 'Transfer Overpayment')}</DialogTitle>
          <DialogDescription>
            {tx('将订单', 'Transfer overpayment from order')} <strong>{transferFromOrder?.orderNo}</strong> {tx('的多付金额转移到其他订单', 'to another order')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label>{tx('当前多付金额', 'Current overpayment')}</Label>
            <div className="text-green-600 font-bold text-lg">{formatUsdAmount(Math.abs(transferFromOrder?.balance || 0))}</div>
          </div>
          <div className="space-y-2">
            <Label>{tx('目标订单号', 'Target order number')}</Label>
            <Input
              placeholder={tx('输入目标订单号', 'Enter target order number')}
              value={transferToOrderNo}
              onChange={(e) => onTransferToOrderNoChange(e.target.value)}
            />
            <p className="text-xs text-gray-500">{tx('如果订单不存在，将创建到 Un_Associated 账单', 'If target order does not exist, it will be created under Un_Associated invoice.')}</p>
          </div>
          <div className="space-y-2">
            <Label>{tx('转移金额', 'Transfer amount')}</Label>
            <MoneyInput value={transferAmount} onValueChange={onTransferAmountChange} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>{tx('取消', 'Cancel')}</Button>
          <Button onClick={onSubmit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {tx('确认转移', 'Confirm Transfer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
