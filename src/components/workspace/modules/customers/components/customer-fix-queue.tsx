'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatOrderNameDisplay } from '@/lib/display-format';

export type CustomerFixQueueProps = {
  fixOrders: Array<Record<string, unknown>>;
  fixReceipts: Array<Record<string, unknown>>;
  tx: (zh: string, en: string) => string;
  onOpenFix: (type: 'order' | 'receipt', row: Record<string, unknown>) => void;
};

export function CustomerFixQueue({ fixOrders, fixReceipts, tx, onOpenFix }: CustomerFixQueueProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{tx('待修复 ORDER', 'Orders To Fix')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {fixOrders.map((row) => (
            <div key={String(row.id)} className="flex justify-between items-center border rounded-md p-2">
              <div>
                <div className="font-medium">{formatOrderNameDisplay(row.orderNo)}</div>
                <div className="text-xs text-red-500">{tx('请修复客户信息', 'Please fix customer information')}</div>
              </div>
              <Button size="sm" onClick={() => onOpenFix('order', row)}>{tx('修复', 'Fix')}</Button>
            </div>
          ))}
          {fixOrders.length === 0 && <p className="text-sm text-gray-500">{tx('暂无', 'None')}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tx('待修复 RECEIPT', 'Receipts To Fix')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {fixReceipts.map((row) => (
            <div key={String(row.id)} className="flex justify-between items-center border rounded-md p-2">
              <div>
                <div className="font-medium">{row.receiptNo ? String(row.receiptNo) : formatOrderNameDisplay(row.orderNo)}</div>
                <div className="text-xs text-red-500">{tx('请修复客户信息', 'Please fix customer information')}</div>
              </div>
              <Button size="sm" onClick={() => onOpenFix('receipt', row)}>{tx('修复', 'Fix')}</Button>
            </div>
          ))}
          {fixReceipts.length === 0 && <p className="text-sm text-gray-500">{tx('暂无', 'None')}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
