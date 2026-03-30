'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pencil, Trash2 } from 'lucide-react';

export type CustomerListProps = {
  customers: Array<Record<string, unknown>>;
  canSeeExtended: boolean;
  isAdmin: boolean;
  tx: (zh: string, en: string) => string;
  phoneConflictMessage: string;
  formatOwnerLabel: (row: Record<string, unknown>) => string;
  truncateLongText: (value: string, maxLength?: number) => string;
  onPreviewLongText: (label: string, value: string) => void;
  onEdit: (row: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
};

export function CustomerList({
  customers,
  canSeeExtended,
  isAdmin,
  tx,
  phoneConflictMessage,
  formatOwnerLabel,
  truncateLongText,
  onPreviewLongText,
  onEdit,
  onDelete,
}: CustomerListProps) {
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>MARK</TableHead>
              <TableHead>ORDER_NAME</TableHead>
              <TableHead>NAME</TableHead>
              <TableHead>PHONE</TableHead>
              <TableHead>CITY</TableHead>
              <TableHead>CONSIGNEE</TableHead>
              <TableHead>{tx('绑定账户', 'Binding')}</TableHead>
              {canSeeExtended && <TableHead>COMPANY_NAME</TableHead>}
              {canSeeExtended && <TableHead>CREDIT</TableHead>}
              {canSeeExtended && <TableHead>COMPANY_ADDRESS</TableHead>}
              <TableHead>{tx('操作', 'Actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.map((row) => {
              const consigneeFull = String(row.consignee || '').trim();
              const addressFull = String(row.companyAddress || '').trim();
              return (
                <TableRow key={String(row.id)}>
                  <TableCell>{String(row.mark || '-')}</TableCell>
                  <TableCell>{String(row.orderName || '-')}</TableCell>
                  <TableCell>{String(row.name || '-')}</TableCell>
                  <TableCell
                    className={row.phoneConflict ? 'text-red-600 font-medium' : undefined}
                    title={row.phoneConflict ? phoneConflictMessage : undefined}
                  >
                    {String(row.phone || '-')}
                  </TableCell>
                  <TableCell>{String(row.city || '-')}</TableCell>
                  <TableCell>
                    {consigneeFull ? (
                      <button
                        type="button"
                        className="max-w-[220px] truncate text-left hover:underline"
                        title={consigneeFull}
                        onClick={() => onPreviewLongText('CONSIGNEE', consigneeFull)}
                      >
                        {truncateLongText(consigneeFull)}
                      </button>
                    ) : '-'}
                  </TableCell>
                  <TableCell>{formatOwnerLabel(row)}</TableCell>
                  {canSeeExtended && <TableCell>{String(row.companyName || '-')}</TableCell>}
                  {canSeeExtended && <TableCell>{row.credit !== null && row.credit !== undefined ? String(row.credit) : '-'}</TableCell>}
                  {canSeeExtended && (
                    <TableCell>
                      {addressFull ? (
                        <button
                          type="button"
                          className="max-w-[260px] truncate text-left hover:underline"
                          title={addressFull}
                          onClick={() => onPreviewLongText('COMPANY_ADDRESS', addressFull)}
                        >
                          {truncateLongText(addressFull)}
                        </button>
                      ) : '-'}
                    </TableCell>
                  )}
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => onEdit(row)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {isAdmin && (
                      <Button size="sm" variant="ghost" onClick={() => onDelete(String(row.id))}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
