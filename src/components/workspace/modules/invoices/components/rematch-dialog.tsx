'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatOrderNameDisplay, formatUsdAmount } from '@/lib/display-format';
import { Loader2 } from 'lucide-react';
import type {
  RematchPreviewGroup,
  RematchSelection,
  RematchTargetInvoice,
  SystemPoolRepairPreview,
} from '../types';

export type RematchDialogProps = {
  open: boolean;
  groups: RematchPreviewGroup[];
  poolRepairs: SystemPoolRepairPreview[];
  targetInvoices: RematchTargetInvoice[];
  poolSelections: Record<string, string>;
  selections: Record<string, RematchSelection>;
  applying: boolean;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  onSelectionChange: (groupId: string, value: Partial<RematchSelection>, group: RematchPreviewGroup) => void;
  onPoolSelectionChange: (sourceOrderId: string, targetInvoiceId: string) => void;
  onApply: () => void;
};

export function RematchDialog({
  open,
  groups,
  poolRepairs,
  targetInvoices,
  poolSelections,
  selections,
  applying,
  tx,
  onOpenChange,
  onSelectionChange,
  onPoolSelectionChange,
  onApply,
}: RematchDialogProps) {
  const hasUnresolvedManualRepair = poolRepairs.some(
    (row) => row.repairMode === 'MANUAL' && !poolSelections[row.sourceOrderId],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-24px)] w-[calc(100vw-24px)] max-w-5xl flex-col overflow-hidden p-0 sm:max-w-5xl sm:p-6">
        <DialogHeader className="px-4 pt-4 sm:px-0 sm:pt-0">
          <DialogTitle>{tx('冲突匹配处理', 'Conflict Match Resolution')}</DialogTitle>
          <DialogDescription>{tx('逐组选择保留订单与处理方式，再执行刷新匹配。', 'Choose keeper and strategy for each group before applying rematch.')}</DialogDescription>
        </DialogHeader>
        <div data-testid="rematch-scroll-body" className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-2 sm:px-0">
          {poolRepairs.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {tx('系统池订单修复', 'System Pool Repairs')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table className="min-w-[760px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>ORDER</TableHead>
                        <TableHead>{tx('来源池', 'Pool')}</TableHead>
                        <TableHead>{tx('金额', 'Amount')}</TableHead>
                        <TableHead>{tx('余额', 'Balance')}</TableHead>
                        <TableHead>{tx('收据数', 'Receipts')}</TableHead>
                        <TableHead>{tx('目标账单', 'Target invoice')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {poolRepairs.map((row) => (
                        <TableRow key={row.sourceOrderId}>
                          <TableCell className="font-medium">{formatOrderNameDisplay(row.orderNo)}</TableCell>
                          <TableCell>{row.sourcePool}</TableCell>
                          <TableCell>{formatUsdAmount(row.amount)}</TableCell>
                          <TableCell>{formatUsdAmount(row.orderBalance)}</TableCell>
                          <TableCell>{row.receiptCount}</TableCell>
                          <TableCell>
                            {row.repairMode === 'AUTO' ? (
                              <div className="space-y-1">
                                <div className="font-medium">{row.targetInvNo || '-'}</div>
                                <div className="text-xs text-muted-foreground">
                                  {tx('将自动迁移', 'Will move automatically')}
                                </div>
                              </div>
                            ) : (
                              <select
                                aria-label={tx(`为 ${formatOrderNameDisplay(row.orderNo)} 选择目标账单`, `Target invoice for ${formatOrderNameDisplay(row.orderNo)}`)}
                                className="h-9 min-w-44 rounded-md border bg-background px-3 text-sm"
                                value={poolSelections[row.sourceOrderId] || ''}
                                onChange={(event) => onPoolSelectionChange(row.sourceOrderId, event.target.value)}
                              >
                                <option value="">{tx('请选择账单', 'Select invoice')}</option>
                                {targetInvoices.map((invoice) => (
                                  <option key={invoice.id} value={invoice.id}>{invoice.invNo}</option>
                                ))}
                              </select>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ) : null}
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
                        {order.invNo} / {formatOrderNameDisplay(order.orderNo)} / {formatUsdAmount(order.amount)}
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
                        <TableCell>{formatOrderNameDisplay(order.orderNo)}</TableCell>
                        <TableCell>{formatUsdAmount(order.amount)}</TableCell>
                        <TableCell>{formatUsdAmount(order.orderBalance)}</TableCell>
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
        <DialogFooter data-testid="rematch-dialog-footer" className="shrink-0 border-t px-4 py-3 sm:px-0 sm:pb-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tx('取消', 'Cancel')}</Button>
          <Button onClick={onApply} disabled={applying || hasUnresolvedManualRepair}>
            {applying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {tx('确认执行', 'Apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
