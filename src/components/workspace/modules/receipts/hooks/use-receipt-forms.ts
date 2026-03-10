'use client';

import { useEffect, useState } from 'react';
import { fetchServerDate, lookupCustomerByOrderNoGroup, type CustomerCandidate } from '@/components/workspace/shared';
import { EMPTY_RECEIPT_DIRECT_FORM, type ReceiptDirectForm } from '../types';

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
    if (!currentOrderNo.trim()) return;
    const timer = setTimeout(() => {
      void lookupCustomerByOrderNoGroup(currentOrderNo).then((matched) => {
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
    if (!currentOrderNo.trim()) return;
    const timer = setTimeout(() => {
      void lookupCustomerByOrderNoGroup(currentOrderNo).then((matched) => {
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
    }
  };

  const handleShowDirectCreateChange = (open: boolean) => {
    setShowDirectCreate(open);
    if (!open) {
      setError(null);
      setDirectCustomerCandidates([]);
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
