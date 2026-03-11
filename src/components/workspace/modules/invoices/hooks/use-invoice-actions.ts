'use client';

import { useState } from 'react';
import { apiCall, getApiResponseErrorMessage, getErrorMessage } from '@/components/workspace/shared';
import type { InvoiceDraftOrder } from '../types';

export type InvoiceActionText = (zh: string, en: string) => string;

export type InvoiceActionDeps = {
  tx: InvoiceActionText;
  invoiceImportInputRef: React.RefObject<HTMLInputElement | null>;
  loadInvoices: () => Promise<void>;
  invNo: string;
  shipDate: string;
  releaseDate: string;
  orders: InvoiceDraftOrder[];
  setFormError: (value: string) => void;
  handleCreateDialogOpenChange: (open: boolean) => void;
  resetCreateInvoiceDialog: () => void;
  editingOrder: {
    id: string;
    orderNo: string;
    amount: number;
    customerMark: string;
    customerName: string;
    customerPhone?: string | null;
    customerCity?: string | null;
    customerId?: string | null;
  } | null;
  setOrderFormError: (value: string) => void;
  handleOrderDialogOpenChange: (open: boolean) => void;
  addingOrderToInvoice: string | null;
  setAddError: (value: string) => void;
  newOrderNo: string;
  newOrderAmount: string;
  newOrderCustomerMark: string;
  newOrderCustomerName: string;
  newOrderCustomerId: string;
  resetAddOrderForm: () => void;
};

export function useInvoiceActions({
  tx,
  invoiceImportInputRef,
  loadInvoices,
  invNo,
  shipDate,
  releaseDate,
  orders,
  setFormError,
  handleCreateDialogOpenChange,
  resetCreateInvoiceDialog,
  editingOrder,
  setOrderFormError,
  handleOrderDialogOpenChange,
  addingOrderToInvoice,
  setAddError,
  newOrderNo,
  newOrderAmount,
  newOrderCustomerMark,
  newOrderCustomerName,
  newOrderCustomerId,
  resetAddOrderForm,
}: InvoiceActionDeps) {
  const [submitting, setSubmitting] = useState(false);

  const downloadInvoiceImportTemplate = async () => {
    try {
      const response = await fetch('/api/invoice?action=import-template', {
        method: 'GET',
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(await getApiResponseErrorMessage(response, tx('模板下载失败', 'Failed to download template')));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'invoice-import-template.xlsx';
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert(error instanceof Error ? error.message : tx('模板下载失败', 'Failed to download template'));
    }
  };

  const openInvoiceImportPicker = () => {
    invoiceImportInputRef.current?.click();
  };

  const handleCreateInvoice = async () => {
    setFormError('');
    if (!invNo.trim()) {
      setFormError(tx('请输入账单号', 'Please enter invoice number.'));
      return;
    }
    if (orders.some((order) => !order.orderNo.trim() || !order.amount || !order.customerMark.trim())) {
      setFormError(tx('请填写所有订单的客户单号、金额和MARK', 'Please fill ORDER, amount and MARK for all rows.'));
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiCall('invoice', {
        method: 'POST',
        body: JSON.stringify({
          invNo,
          shipDate: shipDate || null,
          releaseDate: releaseDate || null,
          orders: orders.map((order) => ({
            orderNo: order.orderNo,
            amount: parseFloat(order.amount),
            customerMark: order.customerMark,
            customerName: order.customerName || null,
            customerId: order.customerId || null,
          })),
        }),
      });

      if (result.success) {
        handleCreateDialogOpenChange(false);
        resetCreateInvoiceDialog();
        if (result.message) {
          alert(result.message);
        }
        await loadInvoices();
      } else {
        setFormError(getErrorMessage(result, tx('创建失败', 'Create failed')));
      }
    } catch (err) {
      setFormError(getErrorMessage(err, tx('网络错误，请重试', 'Network error, please retry.')));
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateOrder = async () => {
    if (!editingOrder) return;
    setOrderFormError('');
    if (!editingOrder.orderNo.trim()) {
      setOrderFormError(tx('请输入客户单号', 'Please enter order number.'));
      return;
    }
    if (!Number.isFinite(editingOrder.amount) || editingOrder.amount < 0) {
      setOrderFormError(tx('请输入有效金额(>=0)', 'Please enter a valid amount (>=0).'));
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiCall('invoice', {
        method: 'PUT',
        body: JSON.stringify({
          action: 'updateOrder',
          orderId: editingOrder.id,
          orderNo: editingOrder.orderNo,
          amount: editingOrder.amount,
          customerMark: editingOrder.customerMark,
          customerName: editingOrder.customerName || null,
          customerPhone: editingOrder.customerPhone || null,
          customerCity: editingOrder.customerCity || null,
          customerId: editingOrder.customerId || null,
        }),
      });

      if (result.success) {
        handleOrderDialogOpenChange(false);
        await loadInvoices();
      } else {
        setOrderFormError(getErrorMessage(result, tx('修改失败', 'Update failed')));
      }
    } catch (err) {
      setOrderFormError(getErrorMessage(err, tx('网络错误，请重试', 'Network error, please retry.')));
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    if (!confirm(tx('确定要删除这个订单吗？', 'Delete this order?'))) return;

    try {
      const result = await apiCall('invoice', {
        method: 'PUT',
        body: JSON.stringify({
          action: 'deleteOrder',
          orderId,
        }),
      });

      if (result.success) {
        await loadInvoices();
      } else {
        alert(getErrorMessage(result, tx('删除失败', 'Delete failed')));
      }
    } catch (err) {
      alert(getErrorMessage(err, tx('网络错误，请重试', 'Network error, please retry.')));
      console.error(err);
    }
  };

  const handleAddOrder = async () => {
    if (!addingOrderToInvoice) return;
    setAddError('');
    if (!newOrderNo.trim()) {
      setAddError(tx('请输入客户单号', 'Please enter order number.'));
      return;
    }
    if (!newOrderAmount || parseFloat(newOrderAmount) <= 0) {
      setAddError(tx('请输入有效金额', 'Please enter a valid amount.'));
      return;
    }
    if (!newOrderCustomerMark.trim()) {
      setAddError(tx('请输入客户MARK', 'Please enter customer MARK.'));
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiCall('invoice', {
        method: 'PUT',
        body: JSON.stringify({
          action: 'addOrder',
          invoiceId: addingOrderToInvoice,
          orderNo: newOrderNo,
          amount: parseFloat(newOrderAmount),
          customerMark: newOrderCustomerMark,
          customerName: newOrderCustomerName || null,
          customerId: newOrderCustomerId || null,
        }),
      });

      if (result.success) {
        resetAddOrderForm();
        await loadInvoices();
      } else {
        setAddError(getErrorMessage(result, tx('添加失败', 'Add failed')));
      }
    } catch (err) {
      setAddError(getErrorMessage(err, tx('网络错误，请重试', 'Network error, please retry.')));
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return {
    submitting,
    downloadInvoiceImportTemplate,
    openInvoiceImportPicker,
    handleCreateInvoice,
    handleUpdateOrder,
    handleDeleteOrder,
    handleAddOrder,
  };
}
