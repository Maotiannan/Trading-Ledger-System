'use client';

import { useCallback, useRef, useState } from 'react';
import type { CustomerImportRowView } from '@/components/workspace/shared';
import type { CustomerFormState } from '../types';

export type CustomerFixTarget = { type: 'order' | 'receipt'; id: string } | null;
export type CustomerLongTextPreview = { label: string; value: string } | null;

export type UseCustomerFormsDeps = {
  isAdmin: boolean;
  defaultOwnerId: string;
  importOwnerId: string;
};

export function useCustomerForms({ isAdmin, defaultOwnerId, importOwnerId }: UseCustomerFormsDeps) {
  const customerImportInputRef = useRef<HTMLInputElement | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [fixingTarget, setFixingTarget] = useState<CustomerFixTarget>(null);
  const [customerImporting, setCustomerImporting] = useState(false);
  const [customerImportRows, setCustomerImportRows] = useState<CustomerImportRowView[]>([]);
  const [showCustomerImportIssues, setShowCustomerImportIssues] = useState(false);
  const [customerIssueSubmitting, setCustomerIssueSubmitting] = useState(false);
  const [customerImportMessage, setCustomerImportMessage] = useState('');
  const [customerLongTextPreview, setCustomerLongTextPreview] = useState<CustomerLongTextPreview>(null);
  const [form, setForm] = useState<CustomerFormState>({
    mark: '',
    orderName: '',
    name: '',
    phone: '',
    city: '',
    consignee: '',
    companyName: '',
    credit: '',
    companyAddress: '',
    ownerId: defaultOwnerId,
  });

  const resetForm = useCallback(() => {
    setForm({
      mark: '',
      orderName: '',
      name: '',
      phone: '',
      city: '',
      consignee: '',
      companyName: '',
      credit: '',
      companyAddress: '',
      ownerId: isAdmin ? (importOwnerId || defaultOwnerId) : defaultOwnerId,
    });
  }, [defaultOwnerId, importOwnerId, isAdmin]);

  const openEdit = useCallback((row: Record<string, unknown>) => {
    setEditing(row);
    setForm({
      mark: String(row.mark || ''),
      orderName: String(row.orderName || ''),
      name: String(row.name || ''),
      phone: String(row.phone || ''),
      city: String(row.city || ''),
      consignee: String(row.consignee || ''),
      companyName: String(row.companyName || ''),
      credit: row.credit === null || row.credit === undefined ? '' : String(row.credit),
      companyAddress: String(row.companyAddress || ''),
      ownerId: String(row.ownerId || importOwnerId || defaultOwnerId),
    });
    setShowCreate(true);
  }, [defaultOwnerId, importOwnerId]);

  const openFix = useCallback((type: 'order' | 'receipt', row: Record<string, unknown>) => {
    setFixingTarget({ type, id: String(row.id) });
    setForm({
      mark: String(row.customerMark || ''),
      orderName: String(row.customerName || ''),
      name: '',
      phone: String(row.customerPhone || ''),
      city: String(row.customerCity || ''),
      consignee: '',
      companyName: '',
      credit: '',
      companyAddress: '',
      ownerId: importOwnerId || defaultOwnerId,
    });
  }, [defaultOwnerId, importOwnerId]);

  const closeCustomerImportDialog = useCallback(() => {
    setShowCustomerImportIssues(false);
    setCustomerImportRows([]);
    setCustomerImportMessage('');
  }, []);

  const updateCustomerImportIssue = useCallback((
    rowNo: number,
    field: keyof Omit<CustomerImportRowView, 'latestStatus' | 'latestReason' | 'attempts'>,
    value: string,
  ) => {
    setCustomerImportRows((prev) =>
      prev.map((row) => {
        if (row.rowNo !== rowNo || row.latestStatus !== 'FAILED') return row;
        return { ...row, [field]: value };
      }),
    );
  }, []);

  return {
    customerImportInputRef,
    showCreate,
    setShowCreate,
    editing,
    setEditing,
    fixingTarget,
    setFixingTarget,
    customerImporting,
    setCustomerImporting,
    customerImportRows,
    setCustomerImportRows,
    showCustomerImportIssues,
    setShowCustomerImportIssues,
    customerIssueSubmitting,
    setCustomerIssueSubmitting,
    customerImportMessage,
    setCustomerImportMessage,
    customerLongTextPreview,
    setCustomerLongTextPreview,
    form,
    setForm,
    resetForm,
    openEdit,
    openFix,
    closeCustomerImportDialog,
    updateCustomerImportIssue,
  };
}
