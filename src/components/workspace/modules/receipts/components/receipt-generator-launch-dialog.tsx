'use client';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type OrderContext = {
  invNo: string | null;
  customer: {
    id: string;
    mark: string;
    name: string;
    phone: string | null;
    city: string | null;
  } | null;
  balanceBefore: number | null;
  preview?: {
    balanceAfter: number | null;
  } | null;
};

export type ReceiptGeneratorLaunchDialogProps = {
  open: boolean;
  orderNo: string;
  usdAmount: string;
  loadingContext: boolean;
  creatingSession: boolean;
  error: string | null;
  context: OrderContext | null;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  onOrderNoChange: (value: string) => void;
  onUsdAmountChange: (value: string) => void;
  onSubmit: () => void;
};

function money(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '-';
  return `$${Number(value).toFixed(2)}`;
}

export function ReceiptGeneratorLaunchDialog({
  open,
  orderNo,
  usdAmount,
  loadingContext,
  creatingSession,
  error,
  context,
  tx,
  onOpenChange,
  onOrderNoChange,
  onUsdAmountChange,
  onSubmit,
}: ReceiptGeneratorLaunchDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tx('生成签名收据', 'Generate Signed Receipt')}</DialogTitle>
          <DialogDescription>
            {tx('先填写订单和金额，再进入签名窗口。签名前系统会先创建一条待签名收据记录。', 'Fill the order and amount first, then continue to the signing window. A pending receipt record will be created before signing.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="receipt-generator-order-no">ORDER NO</Label>
            <Input
              id="receipt-generator-order-no"
              value={orderNo}
              onChange={(event) => onOrderNoChange(event.target.value)}
              placeholder="Big Alpha-07"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="receipt-generator-usd-amount">{tx('收款金额 USD', 'USD Amount')}</Label>
            <Input
              id="receipt-generator-usd-amount"
              type="number"
              min="0"
              step="0.01"
              value={usdAmount}
              onChange={(event) => onUsdAmountChange(event.target.value)}
              placeholder="2500"
            />
          </div>

          <div className="rounded-lg border p-4 text-sm space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium">{tx('订单上下文', 'Order Context')}</span>
              {loadingContext && <span className="text-muted-foreground">{tx('匹配中...', 'Matching...')}</span>}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-muted-foreground">{tx('发票号', 'Invoice No.')}</div>
                <div>{context?.invNo || '-'}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{tx('客户', 'Customer')}</div>
                <div>{context?.customer ? `${context.customer.name} "${context.customer.mark}"` : '-'}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{tx('电话', 'Phone')}</div>
                <div>{context?.customer?.phone || '-'}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{tx('签名前余额', 'Balance Before')}</div>
                <div>{money(context?.balanceBefore ?? null)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{tx('签名后余额', 'Balance After')}</div>
                <div>{money(context?.preview?.balanceAfter ?? null)}</div>
              </div>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tx('取消', 'Cancel')}</Button>
          <Button onClick={onSubmit} disabled={creatingSession}>
            {creatingSession ? tx('创建中...', 'Creating...') : tx('进入签名', 'Continue to signing')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
