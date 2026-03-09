'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2 } from 'lucide-react';
import type { RematchPreviewGroup, RematchSelection } from '../types';

export type RematchDialogProps = {
  open: boolean;
  groups: RematchPreviewGroup[];
  selections: Record<string, RematchSelection>;
  applying: boolean;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  onSelectionChange: (groupId: string, value: Partial<RematchSelection>, group: RematchPreviewGroup) => void;
  onApply: () => void;
};

export function RematchDialog({
  open,
  groups,
  selections,
  applying,
  tx,
  onOpenChange,
  onSelectionChange,
  onApply,
}: RematchDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{tx('冲突匹配处理', 'Conflict Match Resolution')}</DialogTitle>
          <DialogDescription>{tx('逐组选择保留订单与处理方式，再执行刷新匹配。', 'Choose keeper and strategy for each group before applying rematch.')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-auto">
          {groups.map((group) => (
            <Card key={group.groupId}>
              <CardHeader>
                <CardTitle className="text-base">
                  {group.groupType === 'exact' ? tx('同订单号冲突', 'Exact order conflict') : tx('同客组冲突', 'Customer-group conflict')} - {group.groupKey}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <select
                    className="border rounded-md px-3 py-2 text-sm"
                    value={selections[group.groupId]?.keepOrderId || ''}
                    onChange={(e) => onSelectionChange(group.groupId, { keepOrderId: e.target.value }, group)}
                  >
                    {group.orders.map((order) => (
                      <option key={order.id} value={order.id}>
                        {order.invNo} / {order.orderNo} / ${order.amount.toFixed(2)}
                      </option>
                    ))}
                  </select>
                  <select
                    className="border rounded-md px-3 py-2 text-sm"
                    value={selections[group.groupId]?.mode || 'merge'}
                    onChange={(e) => onSelectionChange(group.groupId, { mode: e.target.value as 'keep' | 'merge' }, group)}
                  >
                    <option value="merge">{tx('累加金额并删除其余', 'Merge amounts and delete others')}</option>
                    <option value="keep">{tx('仅保留主订单并删除其余', 'Keep selected order and delete others')}</option>
                  </select>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>INV</TableHead>
                      <TableHead>ORDER</TableHead>
                      <TableHead>{tx('金额', 'Amount')}</TableHead>
                      <TableHead>{tx('余额', 'Balance')}</TableHead>
                      <TableHead>{tx('收据数', 'Receipts')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell>{order.invNo}</TableCell>
                        <TableCell>{order.orderNo}</TableCell>
                        <TableCell>${order.amount.toFixed(2)}</TableCell>
                        <TableCell>${order.orderBalance.toFixed(2)}</TableCell>
                        <TableCell>{order.receiptCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
          {groups.length === 0 && (
            <div className="text-sm text-gray-500">{tx('未发现冲突组，可直接执行自动刷新匹配。', 'No conflict groups found; automatic rematch will still run.')}</div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tx('取消', 'Cancel')}</Button>
          <Button onClick={onApply} disabled={applying}>
            {applying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {tx('确认执行', 'Apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
