'use client';

import type { Receipt } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ListPagination } from '@/components/workspace/modules/shared/list-pagination';
import { formatAppDate } from '@/lib/app-time';
import { formatOrderNameDisplay, formatUsdAmount } from '@/lib/display-format';
import { Check, Eye, PenSquare, Pencil, RotateCcw, Trash2 } from 'lucide-react';

export type ReceiptListProps = {
  receipts: Receipt[];
  paginatedReceipts: Receipt[];
  currentPage: number;
  totalPages: number;
  isAdmin: boolean;
  currentUserId?: string | null;
  canEdit: boolean;
  canResumeSigning: boolean;
  tx: (zh: string, en: string) => string;
  getStatusBadge: (status: string) => React.ReactNode;
  onViewImage: (receipt: Receipt) => void;
  onEditReceipt: (receipt: Receipt) => void;
  onMarkReceived: (receiptId: string) => void;
  onDeleteReceipt: (receiptId: string) => void;
  onReverseTransfer?: (receiptId: string) => void;
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
  currentUserId,
  canEdit,
  canResumeSigning,
  tx,
  getStatusBadge,
  onViewImage,
  onEditReceipt,
  onMarkReceived,
  onDeleteReceipt,
  onReverseTransfer,
  onResumeSigning,
  onPreviousPage,
  onNextPage,
  pageSize,
  pageSizeOptions,
  onPageSizeChange,
}: ReceiptListProps) {
  return <>
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
            {paginatedReceipts.map((receipt) => {
              const canEditThisReceipt = !receipt.isSystemTransfer
                && canEdit
                && (receipt.status !== 'RECEIVED' || isAdmin);
              const isSigningPendingCreator = receipt.status === 'SIGNING_PENDING' && receipt.creator?.id === currentUserId;
              const canDeleteThisReceipt =
                !receipt.isSystemTransfer
                && receipt.status !== 'Bank_Transfer'
                && (receipt.status !== 'RECEIVED' || isAdmin)
                && (receipt.status !== 'SIGNING_PENDING' || isAdmin || isSigningPendingCreator);
              return (
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
                <TableCell>{formatAppDate(receipt.createdAt)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {receipt.imageUrl && (
                      <Button size="sm" variant="ghost" onClick={() => onViewImage(receipt)} title={tx('查看图片', 'View image')}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    )}
                    {canEditThisReceipt && (
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
                    {canDeleteThisReceipt && (
                      <Button size="sm" variant="ghost" onClick={() => onDeleteReceipt(receipt.id)} title={tx('申请删除', 'Request deletion')}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    )}
                    {isAdmin && receipt.isSystemTransfer && onReverseTransfer && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onReverseTransfer(receipt.id)}
                        title={tx('撤销转移', 'Reverse transfer')}
                        className="text-amber-600 hover:text-amber-700"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
            })}
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

      </CardContent>
    </Card>

    {receipts.length > 0 && (
      <ListPagination
        idPrefix="receipt"
        tx={tx}
        currentPage={currentPage}
        totalPages={totalPages}
        totalCount={receipts.length}
        pageSize={pageSize}
        pageSizeOptions={pageSizeOptions}
        onPreviousPage={onPreviousPage}
        onNextPage={onNextPage}
        onPageSizeChange={onPageSizeChange}
      />
    )}
  </>;
}
