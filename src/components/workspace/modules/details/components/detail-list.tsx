'use client';

import type { Detail } from '@/lib/store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatOrderNameDisplay, formatUsdAmount } from '@/lib/display-format';
import { ChevronDown, ChevronRight, Download, Eye, Pencil, Trash2 } from 'lucide-react';
import { ListPagination } from '../../shared/list-pagination';

export type DetailListProps = {
  details: Detail[];
  expandedDetails: Set<string>;
  canEdit: boolean;
  isAdmin: boolean;
  tx: (zh: string, en: string) => string;
  onToggleDetail: (detailId: string) => void;
  onViewImage: (detail: Detail) => void;
  onEditDetail: (detail: Detail) => void;
  onExportDetailPic: (detailId: string) => void;
  onDeleteDetail: (detailId: string) => void;
  currentPage: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  pageSizeOptions: readonly number[];
  onPreviousPage: () => void;
  onNextPage: () => void;
  onPageSizeChange: (pageSize: number) => void;
};

export function DetailList({
  details,
  expandedDetails,
  canEdit,
  isAdmin,
  tx,
  onToggleDetail,
  onViewImage,
  onEditDetail,
  onExportDetailPic,
  onDeleteDetail,
  currentPage,
  totalPages,
  totalCount,
  pageSize,
  pageSizeOptions,
  onPreviousPage,
  onNextPage,
  onPageSizeChange,
}: DetailListProps) {
  if (details.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-gray-500">
          {tx('暂无付款明细', 'No payment details')}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {details.map((detail) => {
        const canEditThisDetail = canEdit && (detail.status !== 'RECEIVED' || isAdmin);
        const canDeleteThisDetail = detail.status !== 'RECEIVED' || isAdmin;
        return (
        <Card key={detail.id} className={detail.status === 'ERROR' ? 'border-red-500' : ''}>
          <CardHeader className="cursor-pointer hover:bg-gray-50" onClick={() => onToggleDetail(detail.id)}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                {expandedDetails.has(detail.id) ? (
                  <ChevronDown className="h-5 w-5 text-gray-500" />
                ) : (
                  <ChevronRight className="h-5 w-5 text-gray-500" />
                )}
                <div>
                  <CardTitle className="text-lg">
                    {tx('付款明细', 'Payment Detail')} - {detail.date ? new Date(detail.date).toLocaleDateString() : tx('日期未知', 'Unknown date')}
                  </CardTitle>
                  <CardDescription>
                    {tx(`${detail.items.length} 笔 | 总计: ${formatUsdAmount(detail.totalAmount)}`, `${detail.items.length} items | Total: ${formatUsdAmount(detail.totalAmount)}`)}
                  </CardDescription>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                {detail.agent?.companyName && (
                  <Badge
                    variant="outline"
                    className="max-w-[14rem] truncate"
                    title={tx(`付款代理：${detail.agent.companyName}`, `Payment agent: ${detail.agent.companyName}`)}
                  >
                    {detail.agent.companyName}
                  </Badge>
                )}
                <Badge variant={detail.status === 'ERROR' ? 'destructive' : 'default'}>{detail.status}</Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    onViewImage(detail);
                  }}
                  title={tx('查看图片', 'View image')}
                >
                  <Eye className="h-4 w-4" />
                </Button>
                {canEditThisDetail && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(event) => {
                      event.stopPropagation();
                      onEditDetail(detail);
                    }}
                    title={tx('修改付款明细', 'Edit payment detail')}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
                {
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(event) => {
                      event.stopPropagation();
                      onExportDetailPic(detail.id);
                    }}
                    title={tx('导出图片', 'Export Pic')}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                }
                {canDeleteThisDetail && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteDetail(detail.id);
                    }}
                    title={tx('申请删除', 'Request deletion')}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>

          {expandedDetails.has(detail.id) && (
            <CardContent className="border-t pt-4">
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tx('唛头', 'Mark')}</TableHead>
                    <TableHead>{tx('单号', 'Order No.')}</TableHead>
                    <TableHead>{tx('金额', 'Amount')}</TableHead>
                    <TableHead>{tx('关联收据', 'Linked Receipt')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.mark || '-'}</TableCell>
                      <TableCell>{formatOrderNameDisplay(item.orderNo)}</TableCell>
                      <TableCell>{formatUsdAmount(item.amount)}</TableCell>
                      <TableCell>
                        {item.receipt ? <Badge variant="outline">{formatOrderNameDisplay(item.receipt.orderNo)}</Badge> : <span className="text-gray-400">{tx('未匹配', 'Unmatched')}</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          )}
        </Card>
      );
      })}
      {totalCount > 0 && (
        <ListPagination
          idPrefix="detail"
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
