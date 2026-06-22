'use client';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/workspace/modules/shared/money-input';
import { formatCustomerPayerLabel } from '@/lib/customer-display';
import { formatUsdAmount } from '@/lib/display-format';
import {
  RECEIPT_GENERATOR_BANK_RECEIVED_BY,
  RECEIPT_GENERATOR_PAYMENT_TYPES,
  RECEIPT_GENERATOR_RECEIVED_BY,
  normalizeReceiptGeneratorPaymentType,
  normalizeReceiptGeneratorReceivedBy,
  type ReceiptGeneratorPaymentType,
  type ReceiptGeneratorReceivedBy,
} from '@/lib/receipt-generator-layout';

type OrderContext = {
  invNo: string | null;
  customer: {
    id: string;
    mark: string;
    companyName?: string | null;
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
  receiptNo: string;
  paymentMode: 'Cash' | 'Transfer';
  paymentType: ReceiptGeneratorPaymentType;
  receivedBy: ReceiptGeneratorReceivedBy;
  loadingContext: boolean;
  creatingSession: boolean;
  error: string | null;
  context: OrderContext | null;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  onOrderNoChange: (value: string) => void;
  onUsdAmountChange: (value: string) => void;
  onReceiptNoChange: (value: string) => void;
  onPaymentModeChange: (value: 'Cash' | 'Transfer') => void;
  onPaymentTypeChange: (value: ReceiptGeneratorPaymentType) => void;
  onReceivedByChange: (value: ReceiptGeneratorReceivedBy) => void;
  onSubmit: () => void;
};

function money(value: number | null) {
  return formatUsdAmount(value);
}

export function ReceiptGeneratorLaunchDialog({
  open,
  orderNo,
  usdAmount,
  receiptNo,
  paymentMode,
  paymentType,
  receivedBy,
  loadingContext,
  creatingSession,
  error,
  context,
  tx,
  onOpenChange,
  onOrderNoChange,
  onUsdAmountChange,
  onReceiptNoChange,
  onPaymentModeChange,
  onPaymentTypeChange,
  onReceivedByChange,
  onSubmit,
}: ReceiptGeneratorLaunchDialogProps) {
  const customerLabel = context?.customer
    ? formatCustomerPayerLabel({
        companyName: context.customer.companyName,
        name: context.customer.name,
        mark: context.customer.mark,
      }, { fallbackToMark: true })
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-hidden p-0 sm:max-w-2xl">
        <div className="flex max-h-[90dvh] flex-col">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle>{tx('生成签名收据', 'Generate Signed Receipt')}</DialogTitle>
            <DialogDescription>
              {tx('先填写订单和金额，再进入签名窗口。签名前系统会先创建一条待签名收据记录。', 'Fill the order and amount first, then continue to the signing window. A pending receipt record will be created before signing.')}
            </DialogDescription>
          </DialogHeader>

        <div data-testid="receipt-generator-scroll-body" className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div className="grid gap-2">
            <Label htmlFor="receipt-generator-receipt-no">{tx('收据号', 'Receipt No.')}</Label>
            <Input
              id="receipt-generator-receipt-no"
              value={receiptNo}
              onChange={(event) => onReceiptNoChange(event.target.value)}
              inputMode="numeric"
              placeholder="0010000"
              readOnly
              className="bg-muted"
            />
            <p className="text-xs text-muted-foreground">
              {tx('提交时由服务器原子分配，显示值仅作预览。', 'The server assigns this atomically on submit. The displayed value is only a preview.')}
            </p>
          </div>

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
            <MoneyInput
              id="receipt-generator-usd-amount"
              min="0"
              step="0.01"
              value={usdAmount}
              onValueChange={onUsdAmountChange}
              placeholder="2500"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="receipt-generator-payment-type">{tx('付款类型', 'Payment Type')}</Label>
            <select
              id="receipt-generator-payment-type"
              className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={paymentType}
              onChange={(event) => onPaymentTypeChange(normalizeReceiptGeneratorPaymentType(event.target.value))}
            >
              {RECEIPT_GENERATOR_PAYMENT_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="receipt-generator-payment-mode">{tx('支付方式', 'Mode de paiement')}</Label>
            <select
              id="receipt-generator-payment-mode"
              className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={paymentMode}
              onChange={(event) => onPaymentModeChange(event.target.value === 'Transfer' ? 'Transfer' : 'Cash')}
            >
              <option value="Cash">Cash</option>
              <option value="Transfer">Transfer</option>
            </select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="receipt-generator-received-by">Reçu par</Label>
            <select
              id="receipt-generator-received-by"
              className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={receivedBy}
              onChange={(event) => onReceivedByChange(normalizeReceiptGeneratorReceivedBy(event.target.value))}
            >
              <option value={RECEIPT_GENERATOR_RECEIVED_BY}>{RECEIPT_GENERATOR_RECEIVED_BY}</option>
              <option value={RECEIPT_GENERATOR_BANK_RECEIVED_BY}>{RECEIPT_GENERATOR_BANK_RECEIVED_BY}</option>
            </select>
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
                <div>{customerLabel || '-'}</div>
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

        <DialogFooter data-testid="receipt-generator-footer" className="shrink-0 border-t px-6 py-4 flex-col-reverse gap-2 sm:flex-row sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tx('取消', 'Cancel')}</Button>
          <Button onClick={onSubmit} disabled={creatingSession}>
            {creatingSession ? tx('创建中...', 'Creating...') : tx('进入签名', 'Continue to signing')}
          </Button>
        </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
