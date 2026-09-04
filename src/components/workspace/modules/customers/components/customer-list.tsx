'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatOrderNameDisplay } from '@/lib/display-format';
import { Pencil, Trash2 } from 'lucide-react';

export type CustomerListProps = {
  customers: Array<Record<string, unknown>>;
  canSeeExtended: boolean;
  isAdmin: boolean;
  canManageNotifications: boolean;
  tx: (zh: string, en: string) => string;
  phoneConflictMessage: string;
  formatOwnerLabel: (row: Record<string, unknown>) => string;
  truncateLongText: (value: string, maxLength?: number) => string;
  onPreviewLongText: (label: string, value: string) => void;
  onOpenOrderNameHistory: (row: Record<string, unknown>, orderName: string) => void;
  onOpenConsignees: (row: Record<string, unknown>) => void;
  onOpenNotificationEmails: (row: Record<string, unknown>) => void;
  onEdit: (row: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
};

export function CustomerList({
  customers,
  canSeeExtended,
  isAdmin,
  canManageNotifications,
  tx,
  phoneConflictMessage,
  formatOwnerLabel,
  truncateLongText,
  onPreviewLongText,
  onOpenOrderNameHistory,
  onOpenConsignees,
  onOpenNotificationEmails,
  onEdit,
  onDelete,
}: CustomerListProps) {
  const getOrderNames = (row: Record<string, unknown>) => {
    const aliases = Array.isArray(row.orderNames)
      ? row.orderNames
        .map((item) => (item && typeof item === 'object' ? String((item as Record<string, unknown>).orderName || '').trim() : ''))
        .filter(Boolean)
      : [];
    const primary = String(row.orderName || '').trim();
    return Array.from(new Set([primary, ...aliases].filter(Boolean)));
  };

  const getConsigneeSummary = (row: Record<string, unknown>) => {
    const rows = Array.isArray(row.consignees)
      ? row.consignees
        .map((item) => {
          if (!item || typeof item !== 'object') return '';
          return String((item as Record<string, unknown>).consignee || '').trim();
        })
        .filter(Boolean)
      : [];
    const legacy = String(row.consignee || '').trim();
    const values = Array.from(new Set([...(legacy ? [legacy] : []), ...rows]));
    if (values.length === 0) return { text: '-', title: '', count: 0 };
    const first = values[0];
    return {
      text: values.length > 1 ? `${truncateLongText(first)} +${values.length - 1}` : truncateLongText(first),
      title: values.join('\n'),
      count: values.length,
    };
  };

  const getNotificationEmailSummary = (row: Record<string, unknown>) => {
    const primary = String(row.primaryNotificationEmail || '').trim();
    const rawCount = Number(row.notificationEmailCount);
    const count = Number.isFinite(rawCount) && rawCount > 0 ? Math.floor(rawCount) : (primary ? 1 : 0);
    return {
      text: primary ? `${primary}${count > 1 ? ` +${count - 1}` : ''}` : '-',
      title: primary || tx('未设置邮箱', 'Email not set'),
    };
  };

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
              <TableHead>EMAIL</TableHead>
              <TableHead>{tx('语言偏好', 'LANGUAGE PREFERENCE')}</TableHead>
              <TableHead>{tx('绑定账户', 'Binding')}</TableHead>
              {canSeeExtended && <TableHead>COMPANY_NAME</TableHead>}
              {canSeeExtended && <TableHead>CREDIT</TableHead>}
              {canSeeExtended && <TableHead>COMPANY_ADDRESS</TableHead>}
              <TableHead>{tx('操作', 'Actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.map((row) => {
              const consigneeSummary = getConsigneeSummary(row);
              const notificationEmailSummary = getNotificationEmailSummary(row);
              const companyNameFull = String(row.companyName || '').trim();
              const addressFull = String(row.companyAddress || '').trim();
              const orderNames = getOrderNames(row);
              return (
                <TableRow key={String(row.id)}>
                  <TableCell>{String(row.mark || '-')}</TableCell>
                  <TableCell>
                    <div className="flex min-w-[160px] flex-wrap gap-1">
                      {orderNames.length > 0 ? orderNames.map((orderName) => (
                        <button
                          key={orderName}
                          type="button"
                          className="rounded-full border px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 hover:underline"
                          onClick={() => onOpenOrderNameHistory(row, orderName)}
                        >
                          {formatOrderNameDisplay(orderName)}
                        </button>
                      )) : '-'}
                    </div>
                  </TableCell>
                  <TableCell>{String(row.name || '-')}</TableCell>
                  <TableCell
                    className={row.phoneConflict ? 'text-red-600 font-medium' : undefined}
                    title={row.phoneConflict ? phoneConflictMessage : undefined}
                  >
                    {String(row.phone || '-')}
                  </TableCell>
                  <TableCell>{String(row.city || '-')}</TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="max-w-[220px] truncate text-left text-blue-700 hover:underline"
                      title={consigneeSummary.title || tx('点击维护 CONSIGNEE', 'Manage CONSIGNEE')}
                      onClick={() => onOpenConsignees(row)}
                    >
                      {consigneeSummary.text}
                    </button>
                  </TableCell>
                  <TableCell>
                    {canManageNotifications ? (
                      <button
                        type="button"
                        className="max-w-[260px] truncate text-left text-blue-700 hover:underline"
                        aria-label={notificationEmailSummary.text === '-' ? notificationEmailSummary.title : notificationEmailSummary.text}
                        title={notificationEmailSummary.title}
                        onClick={() => onOpenNotificationEmails(row)}
                      >
                        {notificationEmailSummary.text}
                      </button>
                    ) : (
                      <span className="inline-block max-w-[260px] truncate" title={notificationEmailSummary.title}>
                        {notificationEmailSummary.text}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {canManageNotifications ? (
                      <button
                        type="button"
                        className="text-left text-blue-700 hover:underline"
                        onClick={() => onOpenNotificationEmails(row)}
                      >
                        {String(row.notificationLanguage || 'ENGLISH').toUpperCase() === 'FRENCH' ? 'Francais' : 'English'}
                      </button>
                    ) : (
                      <span>{String(row.notificationLanguage || 'ENGLISH').toUpperCase() === 'FRENCH' ? 'Francais' : 'English'}</span>
                    )}
                  </TableCell>
                  <TableCell>{formatOwnerLabel(row)}</TableCell>
                  {canSeeExtended && (
                    <TableCell>
                      {companyNameFull ? (
                        <button
                          type="button"
                          className="max-w-[260px] truncate text-left hover:underline"
                          title={companyNameFull}
                          onClick={() => onPreviewLongText('COMPANY_NAME', companyNameFull)}
                        >
                          {truncateLongText(companyNameFull, 35)}
                        </button>
                      ) : '-'}
                    </TableCell>
                  )}
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
