'use client';

import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatOrderNameDisplay, formatUsdAmount } from '@/lib/display-format';
import { isActivePoolRow, type DepositPool } from '@/lib/prepayments/pool-types';
import { PrepaymentDialog } from './prepayment-dialog';
import type { TransferFromOrder } from '../types';

export function DepositPoolTable({ pool, tx, isAdmin, onHistory, onTransfer, onChanged }: {
  pool: DepositPool; tx: (zh: string, en: string) => string; isAdmin: boolean;
  onHistory: (id: string, orderNo: string) => void; onTransfer: (order: TransferFromOrder) => void;
  onChanged: () => void;
}) {
  const [showUsed, setShowUsed] = useState(false);
  const rows = pool.rows.filter(row => showUsed || isActivePoolRow(row));
  return <div className="flex min-w-0 flex-col gap-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button size="sm" variant="outline" aria-pressed={showUsed} onClick={() => setShowUsed(value => !value)}>
        {showUsed ? tx('隐藏已使用记录', 'Hide Used Records') : tx('显示已使用记录', 'Show Used Records')}
      </Button>
      {isAdmin && <PrepaymentDialog onChanged={onChanged} />}
    </div>
    <div className="overflow-x-auto">
      <Table>
        <TableHeader><TableRow>
          <TableHead>ORDER</TableHead><TableHead>MARK</TableHead>
          <TableHead>{tx('可用余额', 'Available')}</TableHead><TableHead>{tx('已使用', 'Used')}</TableHead>
          <TableHead>{tx('预留 / 冻结', 'Reserved / Held')}</TableHead>
          {isAdmin && <TableHead>{tx('操作', 'Actions')}</TableHead>}
        </TableRow></TableHeader>
        <TableBody>{rows.map(row => <TableRow key={row.id}>
          <TableCell className="font-medium">
            {row.orderId ? <Button variant="link" className="h-auto whitespace-normal p-0 text-left" onClick={() => onHistory(row.orderId!, row.orderNo)}>
              {formatOrderNameDisplay(row.orderNo)}
            </Button> : formatOrderNameDisplay(row.orderNo || '-')}
            {row.receiptNo && <div className="text-xs text-muted-foreground">{row.receiptNo}</div>}
            {row.pendingSignature && <Badge variant="outline">{tx('待签名', 'Awaiting Signature')}</Badge>}
          </TableCell>
          <TableCell>{row.customerLabel}</TableCell><TableCell className="whitespace-nowrap">{formatUsdAmount(row.availableAmount)}</TableCell>
          <TableCell className="whitespace-nowrap">{formatUsdAmount(row.usedAmount)}</TableCell>
          <TableCell><div className="whitespace-nowrap">{formatUsdAmount(row.reservedAmount)} / {formatUsdAmount(row.heldAmount)}</div>
            {row.held && <Badge variant="outline">{tx('删除审批中', 'Deletion Pending')}</Badge>}
            {!row.active && <Badge variant="outline">{tx('不可用', 'Unavailable')}</Badge>}
          </TableCell>
          {isAdmin && <TableCell>
            {row.kind === 'CREDIT' && row.creditId && Number(row.availableAmount) > 0
              ? <PrepaymentDialog initialCreditId={row.creditId} onChanged={onChanged} />
              : row.kind === 'LEGACY' && row.orderId && row.legacyBalance !== null && Number(row.availableAmount) > 0 && !row.held
                ? <Button size="sm" variant="ghost" title={tx('转移余额', 'Transfer Balance')}
                  onClick={() => onTransfer({ id: row.orderId!, orderNo: row.orderNo, balance: row.legacyBalance! })}><ArrowRight /></Button> : null}
          </TableCell>}
        </TableRow>)}</TableBody>
      </Table>
      {!rows.length && <p className="py-4 text-center text-muted-foreground">{tx('暂无可用定金', 'No available deposits')}</p>}
    </div>
  </div>;
}
