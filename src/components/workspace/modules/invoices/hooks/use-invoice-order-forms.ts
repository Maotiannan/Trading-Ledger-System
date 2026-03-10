'use client';

import { useState } from 'react';
import { lookupCustomerByOrderNoGroup, type CustomerCandidate } from '@/components/workspace/shared';
import type { Order } from '@/lib/store';
import type { EditingInvoiceOrder, InvoiceDraftOrder } from '../types';

export type LoadCustomerCandidates = (
  mark: string,
  setter: (rows: CustomerCandidate[]) => void,
  setDefaultName?: (value: string) => void,
  setDefaultId?: (value: string) => void,
  setDefaultPhone?: (value: string) => void,
  setDefaultCity?: (value: string) => void,
) => void;

const EMPTY_DRAFT_ORDER: InvoiceDraftOrder = {
  orderNo: '',
  amount: '',
  customerMark: '',
  customerName: '',
  customerId: '',
  customerCandidates: [],
};

export function useInvoiceOrderForms(loadCustomerCandidates: LoadCustomerCandidates) {
  const [showDialog, setShowDialog] = useState(false);
  const [invNo, setInvNo] = useState('');
  const [shipDate, setShipDate] = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  const [orders, setOrders] = useState<InvoiceDraftOrder[]>([{ ...EMPTY_DRAFT_ORDER }]);
  const [formError, setFormError] = useState('');

  const [editingOrder, setEditingOrder] = useState<EditingInvoiceOrder | null>(null);
  const [showOrderDialog, setShowOrderDialog] = useState(false);
  const [orderFormError, setOrderFormError] = useState('');
  const [editingOrderCandidates, setEditingOrderCandidates] = useState<CustomerCandidate[]>([]);

  const [addingOrderToInvoice, setAddingOrderToInvoice] = useState<string | null>(null);
  const [newOrderNo, setNewOrderNo] = useState('');
  const [newOrderAmount, setNewOrderAmount] = useState('');
  const [newOrderCustomerMark, setNewOrderCustomerMark] = useState('');
  const [newOrderCustomerName, setNewOrderCustomerName] = useState('');
  const [newOrderCustomerId, setNewOrderCustomerId] = useState('');
  const [newOrderCustomerCandidates, setNewOrderCustomerCandidates] = useState<CustomerCandidate[]>([]);
  const [addError, setAddError] = useState('');

  const resetCreateInvoiceDialog = () => {
    setFormError('');
    setInvNo('');
    setShipDate('');
    setReleaseDate('');
    setOrders([{ ...EMPTY_DRAFT_ORDER }]);
  };

  const handleCreateDialogOpenChange = (open: boolean) => {
    setShowDialog(open);
    if (!open) resetCreateInvoiceDialog();
  };

  const handleOrderDialogOpenChange = (open: boolean) => {
    setShowOrderDialog(open);
    if (!open) {
      setEditingOrder(null);
      setOrderFormError('');
      setEditingOrderCandidates([]);
    }
  };

  const addOrderRow = () => {
    setOrders((prev) => [...prev, { ...EMPTY_DRAFT_ORDER }]);
  };

  const removeOrder = (index: number) => {
    setOrders((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  };

  const selectCreateInvoiceCustomer = (index: number, customerId: string) => {
    setOrders((prev) => {
      const copy = [...prev];
      const row = copy[index];
      if (!row) return prev;
      row.customerId = customerId;
      const selected = row.customerCandidates.find((candidate) => candidate.id === customerId);
      row.customerName = selected?.orderName || '';
      return copy;
    });
  };

  const updateOrder = (index: number, field: 'orderNo' | 'amount' | 'customerMark', value: string) => {
    const newOrders = [...orders];
    if (!newOrders[index]) return;

    if (field === 'customerMark') {
      newOrders[index].customerMark = value;
      newOrders[index].customerId = '';
      newOrders[index].customerName = '';
      setOrders(newOrders);
      loadCustomerCandidates(
        value,
        (rows) => {
          setOrders((prev) => {
            const copy = [...prev];
            const row = copy[index];
            if (!row) return prev;
            row.customerCandidates = rows;
            if (rows.length === 1) {
              row.customerName = rows[0].orderName;
              row.customerId = rows[0].id;
            }
            return copy;
          });
        },
        (name) => setOrders((prev) => {
          const copy = [...prev];
          if (copy[index]) copy[index].customerName = name;
          return copy;
        }),
        (id) => setOrders((prev) => {
          const copy = [...prev];
          if (copy[index]) copy[index].customerId = id;
          return copy;
        }),
      );
      return;
    }

    if (field === 'orderNo') {
      newOrders[index].orderNo = value;
      setOrders(newOrders);
      const orderInput = value.trim();
      if (orderInput) {
        void lookupCustomerByOrderNoGroup(orderInput).then((matched) => {
          if (!matched) return;
          setOrders((prev) => {
            const copy = [...prev];
            const row = copy[index];
            if (!row) return prev;
            row.customerMark = matched.mark;
            row.customerName = matched.name || row.customerName;
            row.customerId = matched.customerId || row.customerId;
            return copy;
          });
          loadCustomerCandidates(
            matched.mark,
            (rows) => setOrders((prev) => {
              const copy = [...prev];
              if (copy[index]) copy[index].customerCandidates = rows;
              return copy;
            }),
            (name) => setOrders((prev) => {
              const copy = [...prev];
              if (copy[index]) copy[index].customerName = name;
              return copy;
            }),
            (id) => setOrders((prev) => {
              const copy = [...prev];
              if (copy[index]) copy[index].customerId = id;
              return copy;
            }),
          );
        });
      }
      return;
    }

    newOrders[index].amount = value;
    setOrders(newOrders);
  };

  const startAddOrder = (invoiceId: string) => {
    setAddingOrderToInvoice(invoiceId);
  };

  const handleNewOrderNoChange = (value: string) => {
    setNewOrderNo(value);
    if (value.trim()) {
      void lookupCustomerByOrderNoGroup(value).then((matched) => {
        if (!matched) return;
        setNewOrderCustomerMark(matched.mark);
        setNewOrderCustomerName(matched.name);
        setNewOrderCustomerId(matched.customerId);
        loadCustomerCandidates(
          matched.mark,
          setNewOrderCustomerCandidates,
          setNewOrderCustomerName,
          setNewOrderCustomerId,
        );
      });
    }
  };

  const handleNewOrderCustomerMarkChange = (value: string) => {
    setNewOrderCustomerMark(value);
    setNewOrderCustomerId('');
    setNewOrderCustomerName('');
    loadCustomerCandidates(
      value,
      setNewOrderCustomerCandidates,
      setNewOrderCustomerName,
      setNewOrderCustomerId,
    );
  };

  const selectNewOrderCustomer = (customerId: string) => {
    setNewOrderCustomerId(customerId);
    const selected = newOrderCustomerCandidates.find((candidate) => candidate.id === customerId);
    setNewOrderCustomerName(selected?.orderName || '');
  };

  const resetAddOrderForm = () => {
    setAddingOrderToInvoice(null);
    setNewOrderNo('');
    setNewOrderAmount('');
    setNewOrderCustomerMark('');
    setNewOrderCustomerName('');
    setNewOrderCustomerId('');
    setNewOrderCustomerCandidates([]);
    setAddError('');
  };

  const openEditOrder = (invoiceId: string, order: Order) => {
    setEditingOrder({
      id: order.id,
      orderNo: order.orderNo,
      amount: order.amount,
      invoiceId,
      customerMark: order.customerMark || '',
      customerName: order.customerName || '',
      customerPhone: order.customerPhone || '',
      customerCity: order.customerCity || '',
      customerId: '',
    });
    setEditingOrderCandidates([]);
    if (order.customerMark) {
      loadCustomerCandidates(
        order.customerMark,
        setEditingOrderCandidates,
        undefined,
        undefined,
        undefined,
        undefined,
      );
    }
    setShowOrderDialog(true);
  };

  const handleEditingOrderMarkChange = (mark: string) => {
    setEditingOrder((prev) => {
      if (!prev) return prev;
      return { ...prev, customerMark: mark, customerName: '', customerPhone: '', customerCity: '', customerId: '' };
    });
    loadCustomerCandidates(
      mark,
      setEditingOrderCandidates,
      (name) => setEditingOrder((prev) => prev ? ({ ...prev, customerName: name }) : prev),
      (id) => setEditingOrder((prev) => prev ? ({ ...prev, customerId: id }) : prev),
      (phone) => setEditingOrder((prev) => prev ? ({ ...prev, customerPhone: phone }) : prev),
      (city) => setEditingOrder((prev) => prev ? ({ ...prev, customerCity: city }) : prev),
    );
  };

  const selectEditingOrderCustomer = (customerId: string) => {
    const selected = editingOrderCandidates.find((candidate) => candidate.id === customerId);
    setEditingOrder((prev) => prev ? ({
      ...prev,
      customerId,
      customerName: selected?.orderName || '',
      customerPhone: selected?.phone || '',
      customerCity: selected?.city || '',
    }) : prev);
  };

  return {
    showDialog,
    invNo,
    setInvNo,
    shipDate,
    setShipDate,
    releaseDate,
    setReleaseDate,
    orders,
    setOrders,
    formError,
    setFormError,
    resetCreateInvoiceDialog,
    handleCreateDialogOpenChange,
    addOrderRow,
    updateOrder,
    removeOrder,
    selectCreateInvoiceCustomer,
    editingOrder,
    setEditingOrder,
    showOrderDialog,
    orderFormError,
    setOrderFormError,
    editingOrderCandidates,
    handleOrderDialogOpenChange,
    openEditOrder,
    handleEditingOrderMarkChange,
    selectEditingOrderCustomer,
    addingOrderToInvoice,
    addError,
    setAddError,
    newOrderNo,
    newOrderAmount,
    setNewOrderAmount,
    newOrderCustomerMark,
    newOrderCustomerName,
    newOrderCustomerId,
    newOrderCustomerCandidates,
    startAddOrder,
    handleNewOrderNoChange,
    handleNewOrderCustomerMarkChange,
    selectNewOrderCustomer,
    resetAddOrderForm,
  };
}
