'use client';

import { useState } from 'react';
import { apiCall, getErrorMessage } from '@/components/workspace/shared';
import type { Swift } from '@/lib/store';
import type { SwiftDirectForm, SwiftOcrResult } from '../types';

export type SwiftActionText = (zh: string, en: string) => string;

export type SwiftActionDeps = {
  tx: SwiftActionText;
  loadSwifts: () => Promise<void>;
  selectedFile: File | null;
  ocrResult: SwiftOcrResult | null;
  selectedDetailId: string;
  savedImagePath: { path: string; name: string } | null;
  directForm: SwiftDirectForm;
  setOcrResult: (value: SwiftOcrResult | null) => void;
  setImagePreview: (value: string | null) => void;
  setSelectedFile: (value: File | null) => void;
  setSavedImagePath: (value: { path: string; name: string } | null) => void;
  setError: (value: string | null) => void;
  handleShowUploadChange: (open: boolean) => void;
  handleShowDirectCreateChange: (open: boolean) => void;
  resetDirectForm: () => void;
};

export function useSwiftActions({
  tx,
  loadSwifts,
  selectedFile,
  ocrResult,
  selectedDetailId,
  savedImagePath,
  directForm,
  setOcrResult,
  setImagePreview,
  setSelectedFile,
  setSavedImagePath,
  setError,
  handleShowUploadChange,
  handleShowDirectCreateChange,
  resetDirectForm,
}: SwiftActionDeps) {
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
      const result = await fetch('/api/swift', {
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
    if (!selectedFile || !ocrResult || !selectedDetailId) {
      setError(tx('请选择付款明细', 'Please select a payment detail.'));
      return;
    }

    setError(null);
    setSubmitting(true);
    const formData = new FormData();
    formData.append('action', 'confirm');
    formData.append('detailId', selectedDetailId);
    formData.append('data', JSON.stringify(ocrResult));
    formData.append('imagePath', savedImagePath?.path || '');
    formData.append('imageName', savedImagePath?.name || selectedFile.name);

    try {
      const result = await fetch('/api/swift', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }).then((response) => response.json());

      if (result.success) {
        handleShowUploadChange(false);
        setSelectedFile(null);
        setSavedImagePath(null);
        await loadSwifts();
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

  const handleDeleteSwift = async (swift: Swift) => {
    if (swift.hasError) {
      if (!confirm(tx('确定要直接删除这条错误SWIFT记录吗？', 'Delete this erroneous SWIFT record directly?'))) return;
      try {
        const result = await apiCall('swift', {
          method: 'POST',
          body: JSON.stringify({
            action: 'delete',
            swiftId: swift.id,
          }),
        });
        if (!result.success) {
          alert(result.error || tx('删除失败', 'Delete failed'));
          return;
        }
        await loadSwifts();
        return;
      } catch (err) {
        alert(getErrorMessage(err, tx('删除失败', 'Delete failed')));
        return;
      }
    }

    if (!confirm(tx('确定要申请删除这条SWIFT水单吗？删除需要管理员审批。', 'Submit a deletion request for this SWIFT record? Admin approval is required.'))) return;

    const result = await apiCall('deletion', {
      method: 'POST',
      body: JSON.stringify({
        action: 'request',
        targetType: 'SWIFT',
        targetId: swift.id,
      }),
    });

    if (result.success) {
      alert(tx('删除申请已提交，等待管理员审批', 'Deletion request submitted. Waiting for admin approval.'));
      await loadSwifts();
    } else {
      alert(result.error || tx('申请失败', 'Request failed'));
    }
  };

  const handleDirectCreate = async () => {
    setError(null);
    try {
      const result = await apiCall('swift', {
        method: 'POST',
        body: JSON.stringify({
          action: 'direct-create',
          detailId: directForm.detailId,
          amount: Number(directForm.amount),
          date: directForm.date || null,
          senderName: directForm.senderName || null,
          senderAddress: directForm.senderAddress || null,
          receiverName: directForm.receiverName || null,
          receiverAccount: directForm.receiverAccount || null,
        }),
      });
      if (result.success) {
        handleShowDirectCreateChange(false);
        resetDirectForm();
        await loadSwifts();
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
    handleDeleteSwift,
    handleDirectCreate,
  };
}
