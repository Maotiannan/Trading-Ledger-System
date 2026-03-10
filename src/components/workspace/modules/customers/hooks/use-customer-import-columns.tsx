'use client';

import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import type { ImportResultDialogColumn } from '@/components/workspace/components/import-result-dialog';
import type { CustomerImportRowView } from '@/components/workspace/shared';

export function useCustomerImportColumns(
  updateCustomerImportIssue: (
    rowNo: number,
    field: keyof Omit<CustomerImportRowView, 'latestStatus' | 'latestReason' | 'attempts'>,
    value: string,
  ) => void,
) {
  return useMemo<ImportResultDialogColumn<CustomerImportRowView>[]>(() => ([
    {
      key: 'mark',
      header: 'MARK',
      className: 'min-w-[180px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[180px]" value={row.mark} disabled={!canEdit} onChange={(e) => updateCustomerImportIssue(row.rowNo, 'mark', e.target.value)} />
      ),
    },
    {
      key: 'orderName',
      header: 'ORDER_NAME',
      className: 'min-w-[220px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[220px]" value={row.orderName} disabled={!canEdit} onChange={(e) => updateCustomerImportIssue(row.rowNo, 'orderName', e.target.value)} />
      ),
    },
    {
      key: 'name',
      header: 'NAME',
      className: 'min-w-[220px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[220px]" value={row.name} disabled={!canEdit} onChange={(e) => updateCustomerImportIssue(row.rowNo, 'name', e.target.value)} />
      ),
    },
    {
      key: 'phone',
      header: 'PHONE',
      className: 'min-w-[180px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[180px]" value={row.phone} disabled={!canEdit} onChange={(e) => updateCustomerImportIssue(row.rowNo, 'phone', e.target.value)} />
      ),
    },
    {
      key: 'city',
      header: 'CITY',
      className: 'min-w-[160px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[160px]" value={row.city} disabled={!canEdit} onChange={(e) => updateCustomerImportIssue(row.rowNo, 'city', e.target.value)} />
      ),
    },
    {
      key: 'consignee',
      header: 'CONSIGNEE',
      className: 'min-w-[220px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[220px]" value={row.consignee} disabled={!canEdit} onChange={(e) => updateCustomerImportIssue(row.rowNo, 'consignee', e.target.value)} />
      ),
    },
    {
      key: 'companyName',
      header: 'COMPANY_NAME',
      className: 'min-w-[220px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[220px]" value={row.companyName} disabled={!canEdit} onChange={(e) => updateCustomerImportIssue(row.rowNo, 'companyName', e.target.value)} />
      ),
    },
    {
      key: 'credit',
      header: 'CREDIT',
      className: 'min-w-[140px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[140px]" value={row.credit} disabled={!canEdit} onChange={(e) => updateCustomerImportIssue(row.rowNo, 'credit', e.target.value)} />
      ),
    },
    {
      key: 'companyAddress',
      header: 'COMPANY_ADDRESS',
      className: 'min-w-[320px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[320px]" value={row.companyAddress} disabled={!canEdit} onChange={(e) => updateCustomerImportIssue(row.rowNo, 'companyAddress', e.target.value)} />
      ),
    },
    {
      key: 'ownerEmail',
      header: 'SALES_EMAIL',
      className: 'min-w-[220px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[220px]" value={row.ownerEmail} disabled={!canEdit} onChange={(e) => updateCustomerImportIssue(row.rowNo, 'ownerEmail', e.target.value)} />
      ),
    },
  ]), [updateCustomerImportIssue]);
}
