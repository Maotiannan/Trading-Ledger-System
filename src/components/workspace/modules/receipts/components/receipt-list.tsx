'use client';

import type { Receipt } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatOrderNameDisplay, formatUsdAmount } from '@/lib/display-format';
import { Check, Eye, PenSquare, Pencil, Trash2 } from 'lucide-react';

export type ReceiptListProps = {
  receipts: Receipt[];
  paginatedReceipts: Receipt[];
  currentPage: number;
  totalPages: number;
  isAdmin: boolean;
  canEdit: boolean;
  canResumeSigning: boolean;
  tx: (zh: string, en: string) => string;
  getStatusBadge: (status: string) => React.ReactNode;
  onViewImage: (receipt: Receipt) => void;
  onEditReceipt: (receipt: Receipt) => void;
  onMarkReceived: (receiptId: string) => void;
  onDeleteReceipt: (receiptId: string) => void;
  onResumeSigning: (receiptId: string) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  pageSize: number;
  pageSizeOptions: readonly number[];
  onPageSizeChange: (nextPageSize: number) => void;
};

export function ReceiptList({
  receipts,
  paginatedReceipts,
  currentPage,
  totalPages,
  isAdmin,
  canEdit,
  canResumeSigning,
  tx,
  getStatusBadge,
  onViewImage,
  onEditReceipt,
  onMarkReceived,
  onDeleteReceipt,
  onResumeSigning,
  onPreviousPage,
  onNextPage,
  pageSize,
  pageSizeOptions,
  onPageSizeChange,
}: ReceiptListProps) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tx('收据号', 'Receipt No.')}</TableHead>
              <TableHead>{tx('客户单号', 'Order No.')}</TableHead>
              <TableHead>MARK</TableHead>
              <TableHead>{tx('付款金额', 'Amount')}</TableHead>
              <TableHead>{tx('余额', 'Balance')}</TableHead>
              <TableHead>{tx('付款人', 'Payer')}</TableHead>
              <TableHead>{tx('状态', 'Status')}</TableHead>
              <TableHead>{tx('创建时间', 'Created At')}</TableHead>
              <TableHead>{tx('操作', 'Actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedReceipts.map((receipt) => (
              <TableRow key={receipt.id} className={receipt.needsCustomerFix ? 'bg-red-50' : ''}>
                <TableCell>{receipt.receiptNo || '-'}</TableCell>
                <TableCell>
                  {formatOrderNameDisplay(receipt.orderNo)}
                  {receipt.needsCustomerFix && <div className="text-xs text-red-500">{tx('请修复客户信息', 'Please fix customer information')}</div>}
                </TableCell>
                <TableCell>{receipt.customerMark || '-'}</TableCell>
                <TableCell className="font-medium">{formatUsdAmount(receipt.usd)}</TableCell>
                <TableCell className="font-medium">
                  {typeof receipt.balanceAfter === 'number' ? formatUsdAmount(receipt.balanceAfter) : '-'}
                </TableCell>
                <TableCell>{receipt.payer || '-'}</TableCell>
                <TableCell>{getStatusBadge(receipt.status)}</TableCell>
                <TableCell>{new Date(receipt.createdAt).toLocaleDateString()}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {receipt.imageUrl && (
                      <Button size="sm" variant="ghost" onClick={() => onViewImage(receipt)} title={tx('查看图片', 'View image')}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    )}
                    {canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => onEditReceipt(receipt)} title={tx('修改收据', 'Edit receipt')}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {receipt.status === 'SIGNING_PENDING' && canResumeSigning && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onResumeSigning(receipt.id)}
                        title={tx('继续签名', 'Resume signing')}
                        className="text-blue-600 hover:text-blue-700"
                      >
                        <PenSquare className="h-4 w-4" />
                      </Button>
                    )}
                    {receipt.status !== 'RECEIVED' && receipt.status !== 'SIGNING_PENDING' && isAdmin && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onMarkReceived(receipt.id)}
                        title={tx('确认完成', 'Confirm completion')}
                        className="text-green-600 hover:text-green-700"
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                    )}
                    {receipt.status !== 'RECEIVED' && receipt.status !== 'Bank_Transfer' && receipt.status !== 'SIGNING_PENDING' && (
                      <Button size="sm" variant="ghost" onClick={() => onDeleteReceipt(receipt.id)} title={tx('申请删除', 'Request deletion')}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {receipts.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-gray-500">
                  {tx('暂无收据', 'No receipts')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </div>

        {receipts.length > 0 && (
          <div
            data-testid="receipt-pagination-controls"
            className="flex flex-col items-center justify-between gap-3 border-t px-4 py-4 sm:flex-row"
          >
            <div className="flex items-center gap-2">
              <Label htmlFor="receipt-page-size">{tx('每页条数', 'Rows per page')}</Label>
              <select
                id="receipt-page-size"
                aria-label={tx('每页条数', 'Rows per page')}
                className="border rounded-md px-3 py-2 text-sm"
                value={String(pageSize)}
                onChange={(event) => onPageSizeChange(Number(event.target.value))}
              >
                {pageSizeOptions.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" onClick={onPreviousPage} disabled={currentPage === 1}>
                {tx('上一页', 'Previous')}
              </Button>
              <span className="text-sm text-gray-600">
                {tx(`第 ${currentPage} / ${totalPages} 页 (共 ${receipts.length} 条)`, `Page ${currentPage} / ${totalPages} (Total ${receipts.length})`)}
              </span>
              <Button variant="outline" size="sm" onClick={onNextPage} disabled={currentPage === totalPages}>
                {tx('下一页', 'Next')}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
