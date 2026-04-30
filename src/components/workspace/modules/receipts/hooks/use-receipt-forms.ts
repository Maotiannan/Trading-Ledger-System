'use client';

import { useEffect, useState } from 'react';
import { fetchServerDate, lookupOrderContextByOrderNo, type CustomerCandidate } from '@/components/workspace/shared';
import { EMPTY_RECEIPT_DIRECT_FORM, type DirectImageUploadStatus, type PendingDirectImageSelection, type ReceiptDirectForm } from '../types';

export type LoadReceiptCustomerCandidates = (
  mark: string,
  setter: (rows: CustomerCandidate[]) => void,
  setDefaultName?: (value: string) => void,
  setDefaultId?: (value: string) => void,
) => void;

export function useReceiptForms(loadCustomerCandidates: LoadReceiptCustomerCandidates) {
  const [showUpload, setShowUpload] = useState(false);
  const [showDirectCreate, setShowDirectCreate] = useState(false);
  const [ocrResult, setOcrResult] = useState<Record<string, unknown> | null>(null);
  const [ocrCustomerMark, setOcrCustomerMark] = useState('');
  const [ocrCustomerName, setOcrCustomerName] = useState('');
  const [ocrCustomerId, setOcrCustomerId] = useState('');
  const [ocrCustomerCandidates, setOcrCustomerCandidates] = useState<CustomerCandidate[]>([]);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [savedImagePath, setSavedImagePath] = useState<{ path: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [directForm, setDirectForm] = useState<ReceiptDirectForm>({ ...EMPTY_RECEIPT_DIRECT_FORM });
  const [directCustomerCandidates, setDirectCustomerCandidates] = useState<CustomerCandidate[]>([]);
  const [directSavedImagePath, setDirectSavedImagePath] = useState<{ path: string; name: string } | null>(null);
  const [directUploadedImageName, setDirectUploadedImageName] = useState('');
  const [pendingDirectImageSelection, setPendingDirectImageSelection] = useState<PendingDirectImageSelection | null>(null);
  const [directUploadStatus, setDirectUploadStatus] = useState<DirectImageUploadStatus>('idle');
  const [directUploadMessage, setDirectUploadMessage] = useState<string | null>(null);
  const [directUploadProgress, setDirectUploadProgress] = useState<number | null>(null);
  const [directInvConflict, setDirectInvConflict] = useState(false);
  const [directInvConflictCount, setDirectInvConflictCount] = useState(0);
  const [ocrInvConflict, setOcrInvConflict] = useState(false);
  const [ocrInvConflictCount, setOcrInvConflictCount] = useState(0);
  const [viewingImage, setViewingImage] = useState<{ url: string; name: string } | null>(null);

  useEffect(() => {
    if (!showDirectCreate) return;
    void fetchServerDate().then((serverDate) => {
      setDirectForm((prev) => ({ ...prev, date: serverDate }));
    });
  }, [showDirectCreate]);

  useEffect(() => {
    if (!showDirectCreate) return;
    const currentOrderNo = directForm.orderNo;
    if (!currentOrderNo.trim()) {
      queueMicrotask(() => {
        setDirectInvConflict(false);
        setDirectInvConflictCount(0);
      });
      return;
    }
    const timer = setTimeout(() => {
      void lookupOrderContextByOrderNo(currentOrderNo).then((context) => {
        if (context.invoiceSuggestion?.invNo) {
          setDirectForm((prev) => ({ ...prev, invNo: context.invoiceSuggestion?.invNo || prev.invNo }));
          setDirectInvConflict(Boolean(context.invoiceSuggestion.conflict));
          setDirectInvConflictCount(context.invoiceSuggestion.count);
        } else {
          setDirectInvConflict(false);
          setDirectInvConflictCount(0);
        }

        const matched = context.matchedCustomer;
        if (context.phoneSuggestion) {
          setDirectForm((prev) => ({ ...prev, tel: context.phoneSuggestion || prev.tel }));
        }
        if (context.payerSuggestion) {
          setDirectForm((prev) => ({ ...prev, payer: context.payerSuggestion || prev.payer }));
        }
        if (!matched) return;
        setDirectForm((prev) => ({
          ...prev,
          customerMark: matched.mark,
          customerName: matched.name || prev.customerName,
          customerId: matched.customerId || prev.customerId,
        }));
        loadCustomerCandidates(
          matched.mark,
          (rows) => setDirectCustomerCandidates(rows),
          (resolvedName) => setDirectForm((prev) => ({ ...prev, customerName: resolvedName })),
          (resolvedId) => setDirectForm((prev) => ({ ...prev, customerId: resolvedId })),
        );
      });
    }, 260);
    return () => clearTimeout(timer);
  }, [directForm.orderNo, showDirectCreate, loadCustomerCandidates]);

  useEffect(() => {
    if (!showUpload || !ocrResult) return;
    const currentOrderNo = typeof ocrResult.orderNo === 'string' ? ocrResult.orderNo : '';
    if (!currentOrderNo.trim()) {
      queueMicrotask(() => {
        setOcrInvConflict(false);
        setOcrInvConflictCount(0);
      });
      return;
    }
    const timer = setTimeout(() => {
      void lookupOrderContextByOrderNo(currentOrderNo).then((context) => {
        if (context.invoiceSuggestion?.invNo) {
          setOcrResult((prev) => prev ? ({ ...prev, invNo: context.invoiceSuggestion?.invNo || prev.invNo }) : prev);
          setOcrInvConflict(Boolean(context.invoiceSuggestion.conflict));
          setOcrInvConflictCount(context.invoiceSuggestion.count);
        } else {
          setOcrInvConflict(false);
          setOcrInvConflictCount(0);
        }

        const matched = context.matchedCustomer;
        if (!matched) return;
        setOcrCustomerMark(matched.mark);
        setOcrCustomerName(matched.name);
        setOcrCustomerId(matched.customerId);
        loadCustomerCandidates(matched.mark, setOcrCustomerCandidates, setOcrCustomerName, setOcrCustomerId);
      });
    }, 260);
    return () => clearTimeout(timer);
  }, [ocrResult, showUpload, loadCustomerCandidates]);

  const handleShowUploadChange = (open: boolean) => {
    setShowUpload(open);
    if (!open) {
      setError(null);
      setOcrResult(null);
      setImagePreview(null);
      setSavedImagePath(null);
      setOcrCustomerMark('');
      setOcrCustomerName('');
      setOcrCustomerId('');
      setOcrCustomerCandidates([]);
      setOcrInvConflict(false);
      setOcrInvConflictCount(0);
    }
  };

  const handleShowDirectCreateChange = (open: boolean) => {
    setShowDirectCreate(open);
    if (!open) {
      setError(null);
      setDirectCustomerCandidates([]);
      setDirectSavedImagePath(null);
      setDirectUploadedImageName('');
      setPendingDirectImageSelection(null);
      setDirectUploadStatus('idle');
      setDirectUploadMessage(null);
      setDirectUploadProgress(null);
      setDirectInvConflict(false);
      setDirectInvConflictCount(0);
    }
  };

  const handleOcrCustomerMarkChange = (value: string) => {
    setOcrCustomerMark(value);
    setOcrCustomerName('');
    setOcrCustomerId('');
    loadCustomerCandidates(value, setOcrCustomerCandidates, setOcrCustomerName, setOcrCustomerId);
  };

  const handleOcrCustomerSelect = (customerId: string) => {
    setOcrCustomerId(customerId);
    const selected = ocrCustomerCandidates.find((candidate) => candidate.id === customerId);
    setOcrCustomerName(selected?.orderName || '');
  };

  const handleDirectCustomerMarkChange = (value: string) => {
    setDirectForm((prev) => ({ ...prev, customerMark: value, customerName: '', customerId: '' }));
    loadCustomerCandidates(
      value,
      (rows) => setDirectCustomerCandidates(rows),
      (name) => setDirectForm((prev) => ({ ...prev, customerName: name })),
      (id) => setDirectForm((prev) => ({ ...prev, customerId: id })),
    );
  };

  const handleDirectCustomerSelect = (customerId: string) => {
    const selected = directCustomerCandidates.find((candidate) => candidate.id === customerId);
    setDirectForm((prev) => ({ ...prev, customerId, customerName: selected?.orderName || '' }));
  };

  const resetDirectForm = () => {
    setDirectForm({ ...EMPTY_RECEIPT_DIRECT_FORM });
    setDirectCustomerCandidates([]);
    setDirectSavedImagePath(null);
    setDirectUploadedImageName('');
    setPendingDirectImageSelection(null);
    setDirectUploadStatus('idle');
    setDirectUploadMessage(null);
    setDirectUploadProgress(null);
    setDirectInvConflict(false);
    setDirectInvConflictCount(0);
  };

  return {
    showUpload,
    showDirectCreate,
    ocrResult,
    setOcrResult,
    ocrCustomerMark,
    setOcrCustomerMark,
    ocrCustomerName,
    setOcrCustomerName,
    ocrCustomerId,
    setOcrCustomerId,
    ocrCustomerCandidates,
    setOcrCustomerCandidates,
    imagePreview,
    setImagePreview,
    selectedFile,
    setSelectedFile,
    savedImagePath,
    setSavedImagePath,
    error,
    setError,
    directForm,
    setDirectForm,
    directCustomerCandidates,
    directSavedImagePath,
    setDirectSavedImagePath,
    directUploadedImageName,
    setDirectUploadedImageName,
    pendingDirectImageSelection,
    setPendingDirectImageSelection,
    directUploadStatus,
    setDirectUploadStatus,
    directUploadMessage,
    setDirectUploadMessage,
    directUploadProgress,
    setDirectUploadProgress,
    directInvConflict,
    directInvConflictCount,
    ocrInvConflict,
    ocrInvConflictCount,
    viewingImage,
    setViewingImage,
    handleShowUploadChange,
    handleShowDirectCreateChange,
    handleOcrCustomerMarkChange,
    handleOcrCustomerSelect,
    handleDirectCustomerMarkChange,
    handleDirectCustomerSelect,
    resetDirectForm,
  };
}
