'use client';

import { useState } from 'react';
import { apiCall } from '@/components/workspace/shared';
import type { DetailDirectItemForm, DetailOcrResult } from '../types';

export type DetailActionText = (zh: string, en: string) => string;

export type DetailActionDeps = {
  tx: DetailActionText;
  loadDetails: () => Promise<void>;
  selectedFile: File | null;
  ocrResult: DetailOcrResult | null;
  savedImagePath: { path: string; name: string } | null;
  directDate: string;
  directItems: DetailDirectItemForm[];
  setOcrResult: (value: DetailOcrResult | null) => void;
  setImagePreview: (value: string | null) => void;
  setSelectedFile: (value: File | null) => void;
  setError: (value: string | null) => void;
  setSavedImagePath: (value: { path: string; name: string } | null) => void;
  handleShowUploadChange: (open: boolean) => void;
  handleShowDirectCreateChange: (open: boolean) => void;
  resetDirectForm: () => void;
};

export function useDetailActions({
  tx,
  loadDetails,
  selectedFile,
  ocrResult,
  savedImagePath,
  directDate,
  directItems,
  setOcrResult,
  setImagePreview,
  setSelectedFile,
  setError,
  setSavedImagePath,
  handleShowUploadChange,
  handleShowDirectCreateChange,
  resetDirectForm,
}: DetailActionDeps) {
  const [uploading, setUploading] = useState(false);
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
      const result = await fetch('/api/detail', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }).then((response) => response.json());

      if (result.success) {
        setOcrResult(result.data.ocrResult);
        setSavedImagePath(result.data.image || null);
      } else {
        setSavedImagePath(null);
        setError(result.error || tx('AI识别失败，请重试', 'AI recognition failed, please retry.'));
      }
    } catch (err) {
      console.error('OCR error:', err);
      setSavedImagePath(null);
      setError(tx('网络错误，请重试', 'Network error, please retry.'));
    }
    setUploading(false);
  };

  const handleConfirm = async () => {
    if (!selectedFile || !ocrResult) return;

    setError(null);
    setSubmitting(true);
    const formData = new FormData();
    formData.append('action', 'confirm');
    formData.append('data', JSON.stringify(ocrResult));
    formData.append('imagePath', savedImagePath?.path || '');
    formData.append('imageName', savedImagePath?.name || selectedFile.name);

    try {
      const result = await fetch('/api/detail', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }).then((response) => response.json());

      if (result.success) {
        handleShowUploadChange(false);
        setSelectedFile(null);
        setSavedImagePath(null);
        await loadDetails();
      } else {
        setError(result.error || tx('创建失败，请重试', 'Create failed, please retry.'));
      }
    } catch (err) {
      console.error('Confirm error:', err);
      setError(tx('网络错误，请重试', 'Network error, please retry.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteDetail = async (detailId: string) => {
    if (!confirm(tx('确定要申请删除这条付款明细吗？删除需要管理员审批。', 'Submit a deletion request for this payment detail? Admin approval is required.'))) {
      return;
    }

    const result = await apiCall('deletion', {
      method: 'POST',
      body: JSON.stringify({
        action: 'request',
        targetType: 'DETAIL',
        targetId: detailId,
      }),
    });

    if (result.success) {
      alert(tx('删除申请已提交，等待管理员审批', 'Deletion request submitted. Waiting for admin approval.'));
      await loadDetails();
    } else {
      alert(result.error || tx('申请失败', 'Request failed'));
    }
  };

  const handleDirectCreate = async () => {
    setError(null);
    try {
      const payloadItems = directItems
        .filter((item) => item.amount && Number(item.amount) > 0)
        .map((item) => ({
          mark: item.mark || null,
          orderNo: item.orderNo || null,
          amount: Number(item.amount),
        }));

      const result = await apiCall('detail', {
        method: 'POST',
        body: JSON.stringify({
          action: 'direct-create',
          date: directDate || null,
          items: payloadItems,
        }),
      });

      if (result.success) {
        handleShowDirectCreateChange(false);
        resetDirectForm();
        await loadDetails();
      } else {
        setError(result.error || tx('创建失败', 'Create failed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tx('创建失败', 'Create failed'));
    }
  };

  return {
    uploading,
    submitting,
    handleFileSelect,
    handleConfirm,
    handleDeleteDetail,
    handleDirectCreate,
  };
}
