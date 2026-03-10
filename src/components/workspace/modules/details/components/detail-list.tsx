'use client';

import type { Detail } from '@/lib/store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronDown, ChevronRight, Eye, Trash2 } from 'lucide-react';

export type DetailListProps = {
  details: Detail[];
  expandedDetails: Set<string>;
  tx: (zh: string, en: string) => string;
  onToggleDetail: (detailId: string) => void;
  onViewImage: (detail: Detail) => void;
  onDeleteDetail: (detailId: string) => void;
};

export function DetailList({ details, expandedDetails, tx, onToggleDetail, onViewImage, onDeleteDetail }: DetailListProps) {
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
      {details.map((detail) => (
        <Card key={detail.id} className={detail.status === 'ERROR' ? 'border-red-500' : ''}>
          <CardHeader className="cursor-pointer hover:bg-gray-50" onClick={() => onToggleDetail(detail.id)}>
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-4">
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
                    {tx(`${detail.items.length} 笔 | 总计: $${detail.totalAmount.toFixed(2)}`, `${detail.items.length} items | Total: $${detail.totalAmount.toFixed(2)}`)}
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={detail.status === 'ERROR' ? 'destructive' : 'default'}>{detail.status}</Badge>
                {detail.imageUrl && (
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
                )}
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
              </div>
            </div>
          </CardHeader>

          {expandedDetails.has(detail.id) && (
            <CardContent className="border-t pt-4">
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
                      <TableCell>{item.orderNo || '-'}</TableCell>
                      <TableCell>${item.amount.toFixed(2)}</TableCell>
                      <TableCell>
                        {item.receipt ? <Badge variant="outline">{item.receipt.orderNo}</Badge> : <span className="text-gray-400">{tx('未匹配', 'Unmatched')}</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}
