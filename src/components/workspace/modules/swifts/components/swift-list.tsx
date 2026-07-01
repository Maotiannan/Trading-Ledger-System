'use client';

import type { Swift } from '@/lib/store';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatUsdAmount } from '@/lib/display-format';
import { AlertTriangle, Check, Eye, Pencil, Trash2 } from 'lucide-react';
import { ListPagination } from '../../shared/list-pagination';

export type SwiftListProps = {
  swifts: Swift[];
  isAdmin: boolean;
  canEdit: boolean;
  tx: (zh: string, en: string) => string;
  getSwiftStatus: (swift: Swift) => string;
  onViewImage: (swift: Swift) => void;
  onEditSwift: (swift: Swift) => void;
  onMarkReceived: (swiftId: string) => void;
  onDeleteSwift: (swift: Swift) => void;
  currentPage: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  pageSizeOptions: readonly number[];
  onPreviousPage: () => void;
  onNextPage: () => void;
  onPageSizeChange: (pageSize: number) => void;
};

export function SwiftList({
  swifts,
  isAdmin,
  canEdit,
  tx,
  getSwiftStatus,
  onViewImage,
  onEditSwift,
  onMarkReceived,
  onDeleteSwift,
  currentPage,
  totalPages,
  totalCount,
  pageSize,
  pageSizeOptions,
  onPreviousPage,
  onNextPage,
  onPageSizeChange,
}: SwiftListProps) {
  if (swifts.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-gray-500">
          {tx('暂无SWIFT水单', 'No SWIFT records')}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      {swifts.map((swift) => {
        const status = getSwiftStatus(swift);
        return (
          <Card key={swift.id} className={swift.hasError ? 'border-red-500' : ''}>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-lg">
                    SWIFT - {swift.date ? new Date(swift.date).toLocaleDateString() : tx('日期未知', 'Unknown date')}
                  </CardTitle>
                  <CardDescription>
                    {tx(`汇款金额: ${formatUsdAmount(swift.amount)} | 汇款人: ${swift.senderName || '-'}`, `Amount: ${formatUsdAmount(swift.amount)} | Sender: ${swift.senderName || '-'}`)}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <Badge variant={status === 'RECEIVED' ? 'default' : status === 'ERROR' ? 'destructive' : 'outline'}>
                    {status}
                  </Badge>
                  {swift.hasError && <AlertTriangle className="h-5 w-5 text-red-500" />}
                  {swift.imageUrl && (
                    <Button size="sm" variant="ghost" onClick={() => onViewImage(swift)} title={tx('查看文件', 'View file')}>
                      <Eye className="h-4 w-4" />
                    </Button>
                  )}
                  {canEdit && (
                    <Button size="sm" variant="ghost" onClick={() => onEditSwift(swift)} title={tx('修改SWIFT', 'Edit SWIFT')}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                  {isAdmin && status === 'Bank_Transfer' && !swift.hasError && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onMarkReceived(swift.id)}
                      title={tx('签收SWIFT', 'Confirm SWIFT received')}
                      className="text-green-600 hover:text-green-700"
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onDeleteSwift(swift)}
                    title={swift.hasError ? tx('直接删除', 'Delete directly') : tx('申请删除', 'Request deletion')}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {swift.hasError && swift.errorMessage && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{swift.errorMessage}</AlertDescription>
                </Alert>
              )}
              <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                <div><span className="text-gray-500">{tx('汇款人:', 'Sender:')}</span> {swift.senderName}</div>
                <div><span className="text-gray-500">{tx('汇款人地址:', 'Sender Address:')}</span> {swift.senderAddress || '-'}</div>
                <div><span className="text-gray-500">{tx('收款人:', 'Receiver:')}</span> {swift.receiverName || '-'}</div>
                <div><span className="text-gray-500">{tx('收款账号:', 'Receiver Account:')}</span> {swift.receiverAccount || '-'}</div>
              </div>
            </CardContent>
          </Card>
        );
      })}
      {totalCount > 0 && (
        <ListPagination
          idPrefix="swift"
          tx={tx}
          currentPage={currentPage}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={pageSize}
          pageSizeOptions={pageSizeOptions}
          onPreviousPage={onPreviousPage}
          onNextPage={onNextPage}
          onPageSizeChange={onPageSizeChange}
        />
      )}
    </div>
  );
}
