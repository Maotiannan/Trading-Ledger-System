'use client';

import { useState } from 'react';
import { apiCall, apiUploadCall, getErrorMessage } from '@/components/workspace/shared';
import { compressReceiptDirectImage } from '../utils/image-compression';
import type { ReceiptDirectForm } from '../types';

export type ReceiptActionText = (zh: string, en: string) => string;

export type ReceiptActionDeps = {
  tx: ReceiptActionText;
  loadReceipts: () => Promise<void>;
  selectedFile: File | null;
  ocrResult: Record<string, unknown> | null;
  ocrCustomerMark: string;
  ocrCustomerName: string;
  ocrCustomerId: string;
  savedImagePath: { path: string; name: string } | null;
  directSavedImagePath: { path: string; name: string } | null;
  directForm: ReceiptDirectForm;
  setOcrResult: (value: Record<string, unknown> | null) => void;
  setOcrCustomerMark: (value: string) => void;
  setOcrCustomerName: (value: string) => void;
  setOcrCustomerId: (value: string) => void;
  setOcrCustomerCandidates: (value: Array<{ id: string; mark: string; orderName: string; displayName: string; phone: string | null; city: string | null }>) => void;
  setImagePreview: (value: string | null) => void;
  setSelectedFile: (value: File | null) => void;
  setSavedImagePath: (value: { path: string; name: string } | null) => void;
  setDirectSavedImagePath: (value: { path: string; name: string } | null) => void;
  setDirectUploadedImageName: (value: string) => void;
  setDirectUploadStatus: (value: 'idle' | 'compressing' | 'uploading' | 'saving' | 'success' | 'failed') => void;
  setDirectUploadMessage: (value: string | null) => void;
  setDirectUploadProgress: (value: number | null) => void;
  setError: (value: string | null) => void;
  handleShowUploadChange: (open: boolean) => void;
  handleShowDirectCreateChange: (open: boolean) => void;
  resetDirectForm: () => void;
};

export function useReceiptActions({
  tx,
  loadReceipts,
  selectedFile,
  ocrResult,
  ocrCustomerMark,
  ocrCustomerName,
  ocrCustomerId,
  savedImagePath,
  directSavedImagePath,
  directForm,
  setOcrResult,
  setOcrCustomerMark,
  setOcrCustomerName,
  setOcrCustomerId,
  setOcrCustomerCandidates,
  setImagePreview,
  setSelectedFile,
  setSavedImagePath,
  setDirectSavedImagePath,
  setDirectUploadedImageName,
  setDirectUploadStatus,
  setDirectUploadMessage,
  setDirectUploadProgress,
  setError,
  handleShowUploadChange,
  handleShowDirectCreateChange,
  resetDirectForm,
}: ReceiptActionDeps) {
  const DIRECT_UPLOAD_IDLE_TIMEOUT_MS = 15_000;
  const DIRECT_UPLOAD_HARD_TIMEOUT_MS = 120_000;
  const [uploading, setUploading] = useState(false);
  const [directUploading, setDirectUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setUploading(true);
    setError(null);

    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('action', 'recognize');

    try {
      const result = await fetch('/api/receipt', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }).then((response) => response.json());

      if (result.success) {
        setOcrResult(result.data.ocrResult);
        setOcrCustomerMark('');
        setOcrCustomerName('');
        setOcrCustomerId('');
        setOcrCustomerCandidates([]);
        setSavedImagePath(result.data.image || null);
      } else {
        setSavedImagePath(null);
        setError(getErrorMessage(result, tx('AI识别失败，请重试', 'AI recognition failed, please retry.')));
      }
    } catch (err) {
      console.error('OCR error:', err);
      setSavedImagePath(null);
      setError(getErrorMessage(err, tx('网络错误，请重试', 'Network error, please retry.')));
    }
    setUploading(false);
  };

  const handleConfirm = async () => {
    if (!selectedFile || !ocrResult) return;
    if (!ocrCustomerMark.trim()) {
      setError(tx('客户MARK不能为空', 'Customer MARK is required.'));
      return;
    }

    setError(null);
    setSubmitting(true);
    const formData = new FormData();
    const payload = {
      ...ocrResult,
      customerMark: ocrCustomerMark.trim(),
      customerName: ocrCustomerName || null,
      customerId: ocrCustomerId || null,
    };
    formData.append('action', 'confirm');
    formData.append('data', JSON.stringify(payload));
    formData.append('imagePath', savedImagePath?.path || '');
    formData.append('imageName', savedImagePath?.name || selectedFile.name);

    try {
      const result = await fetch('/api/receipt', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }).then((response) => response.json());

      if (result.success) {
        handleShowUploadChange(false);
        setSelectedFile(null);
        await loadReceipts();
      } else {
        setError(getErrorMessage(result, tx('创建失败，请重试', 'Create failed, please retry.')));
      }
    } catch (err) {
      console.error('Confirm error:', err);
      setError(getErrorMessage(err, tx('网络错误，请重试', 'Network error, please retry.')));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDirectImageSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setDirectUploading(true);
    setError(null);
    setDirectUploadStatus('compressing');
    setDirectUploadMessage(tx('正在压缩图片...', 'Compressing image...'));
    setDirectUploadProgress(null);

    let uploadFile = file;
    try {
      const prepared = await compressReceiptDirectImage(file);
      uploadFile = prepared.file;
      setDirectUploadStatus('uploading');
      setDirectUploadMessage(prepared.compressed
        ? tx('正在上传压缩后的图片（0%）...', 'Uploading compressed image (0%)...')
        : tx('正在上传图片（0%）...', 'Uploading image (0%)...'));
      setDirectUploadProgress(0);
    } catch (err) {
      const message = getErrorMessage(err, tx('图片压缩失败，请重试', 'Image compression failed, please retry.'));
      setDirectSavedImagePath(null);
      setDirectUploadedImageName('');
      setDirectUploadStatus('failed');
      setDirectUploadMessage(message);
      setDirectUploadProgress(null);
      setError(message);
      setDirectUploading(false);
      event.target.value = '';
      return;
    }

    const formData = new FormData();
    formData.append('action', 'upload');
    formData.append('category', 'receipt-direct');
    formData.append('file', uploadFile);

    try {
      const result = await apiUploadCall('upload-image', formData, {
        method: 'POST',
        idleTimeoutMs: DIRECT_UPLOAD_IDLE_TIMEOUT_MS,
        hardTimeoutMs: DIRECT_UPLOAD_HARD_TIMEOUT_MS,
        onUploadProgress: ({ percent }) => {
          if (typeof percent !== 'number') return;
          setDirectUploadProgress(percent);
          setDirectUploadStatus('uploading');
          setDirectUploadMessage(tx(`正在上传图片（${percent}%）...`, `Uploading image (${percent}%)...`));
        },
        onUploadStageChange: (stage) => {
          if (stage === 'saving') {
            setDirectUploadStatus('saving');
            setDirectUploadProgress(100);
            setDirectUploadMessage(tx('图片已上传，服务器正在保存...', 'Image uploaded. Saving on server...'));
          }
        },
      });
      if (result.success && result.data?.path && result.data?.name) {
        setDirectSavedImagePath({
          path: String(result.data.path),
          name: String(result.data.name),
        });
        setDirectUploadedImageName(String(result.data.name));
        setDirectUploadStatus('success');
        setDirectUploadProgress(100);
        setDirectUploadMessage(tx('图片上传成功', 'Image uploaded successfully.'));
      } else {
        setDirectSavedImagePath(null);
        setDirectUploadedImageName('');
        const message = getErrorMessage(result, tx('图片上传失败，请重试', 'Image upload failed, please retry.'));
        setDirectUploadStatus('failed');
        setDirectUploadMessage(message);
        setDirectUploadProgress(null);
        setError(message);
      }
    } catch (err) {
      setDirectSavedImagePath(null);
      setDirectUploadedImageName('');
      const message = getErrorMessage(err, tx('图片上传失败，请重试', 'Image upload failed, please retry.'));
      setDirectUploadStatus('failed');
      setDirectUploadMessage(message);
      setDirectUploadProgress(null);
      setError(message);
    } finally {
      setDirectUploading(false);
      event.target.value = '';
    }
  };

  const handleMarkReceived = async (receiptId: string) => {
    if (!confirm(tx('确定要确认此收据已完成吗？', 'Confirm this receipt as completed?'))) return;

    try {
      const result = await fetch('/api/receipt', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark-received', receiptId }),
      }).then((response) => response.json());

      if (result.success) {
        await loadReceipts();
      } else {
        alert(getErrorMessage(result, tx('操作失败', 'Operation failed')));
      }
    } catch (err) {
      alert(getErrorMessage(err, tx('网络错误，请重试', 'Network error, please retry.')));
      console.error(err);
    }
  };

  const handleDirectCreate = async () => {
    setError(null);
    if (!directForm.customerMark.trim()) {
      setError(tx('客户MARK不能为空', 'Customer MARK is required.'));
      return;
    }
    try {
      const result = await apiCall('receipt', {
        method: 'POST',
        body: JSON.stringify({
          action: 'direct-create',
          receiptNo: directForm.receiptNo || null,
          date: directForm.date || null,
          tel: directForm.tel || null,
          usd: Number(directForm.usd),
          invNo: directForm.invNo || null,
          orderNo: directForm.orderNo || null,
          payer: directForm.payer || null,
          customerMark: directForm.customerMark || null,
          customerName: directForm.customerName || null,
          customerId: directForm.customerId || null,
          isDeposit: directForm.isDeposit,
          imagePath: directSavedImagePath?.path || null,
          imageName: directSavedImagePath?.name || null,
        }),
      });
      if (result.success) {
        handleShowDirectCreateChange(false);
        resetDirectForm();
        await loadReceipts();
      } else {
        setError(getErrorMessage(result, tx('创建失败，请重试', 'Create failed, please retry.')));
      }
    } catch (err) {
      setError(getErrorMessage(err, tx('创建失败，请重试', 'Create failed, please retry.')));
    }
  };

  const handleDeleteReceipt = async (receiptId: string) => {
    if (!confirm(tx('确定要申请删除这条收据吗？删除需要管理员审批。', 'Submit a deletion request for this receipt? Admin approval is required.'))) return;

    const result = await apiCall('deletion', {
      method: 'POST',
      body: JSON.stringify({
        action: 'request',
        targetType: 'RECEIPT',
        targetId: receiptId,
      }),
    });

    if (result.success) {
      alert(tx('删除申请已提交，等待管理员审批', 'Deletion request submitted. Waiting for admin approval.'));
      await loadReceipts();
    } else {
      alert(getErrorMessage(result, tx('申请失败', 'Request failed')));
    }
  };

  return {
    uploading,
    directUploading,
    submitting,
    handleFileSelect,
    handleConfirm,
    handleDirectImageSelect,
    handleMarkReceived,
    handleDirectCreate,
    handleDeleteReceipt,
  };
}
