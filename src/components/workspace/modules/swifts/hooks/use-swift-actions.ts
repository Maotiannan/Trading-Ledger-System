'use client';

import { useState } from 'react';
import { apiCall, getErrorMessage } from '@/components/workspace/shared';
import type { Swift } from '@/lib/store';
import type { SwiftDirectForm, SwiftOcrResult } from '../types';
import type { SwiftEditablePatch } from '@/lib/swift-edit-types';

export type SwiftActionText = (zh: string, en: string) => string;

export type SwiftActionDeps = {
  tx: SwiftActionText;
  loadSwifts: () => Promise<void>;
  loadSwiftEditRequests?: () => Promise<void>;
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
  loadSwiftEditRequests,
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

  const reloadSwiftViews = async () => {
    await loadSwifts();
    if (loadSwiftEditRequests) {
      await loadSwiftEditRequests();
    }
  };

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
        setError(getErrorMessage(result, tx('创建失败，请重试', 'Create failed, please retry.')));
      }
    } catch (err) {
      console.error('Confirm error:', err);
      setError(getErrorMessage(err, tx('网络错误，请重试', 'Network error, please retry.')));
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
          alert(getErrorMessage(result, tx('删除失败', 'Delete failed')));
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
      alert(getErrorMessage(result, tx('申请失败', 'Request failed')));
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
        setError(getErrorMessage(result, tx('创建失败', 'Create failed')));
      }
    } catch (err) {
      setError(getErrorMessage(err, tx('创建失败', 'Create failed')));
    }
  };

  const handleSubmitSwiftEdit = async (params: {
    swiftId: string;
    data: SwiftEditablePatch;
    isAdmin: boolean;
  }) => {
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiCall('swift', {
        method: 'POST',
        body: JSON.stringify({
          action: params.isAdmin ? 'update' : 'request-edit',
          swiftId: params.swiftId,
          data: params.data,
        }),
      });

      if (!result.success) {
        const message = getErrorMessage(result, tx('修改失败，请重试', 'Edit failed, please retry.'));
        setError(message);
        return { success: false, message };
      }

      const successMessage = result.message
        || (params.isAdmin
          ? tx('修改已完成', 'Update completed.')
          : tx('成功提交，等待管理员同意', 'Submitted successfully. Waiting for admin approval.'));
      alert(successMessage);
      await reloadSwiftViews();
      return { success: true, message: successMessage };
    } catch (err) {
      const message = getErrorMessage(err, tx('修改失败，请重试', 'Edit failed, please retry.'));
      setError(message);
      return { success: false, message };
    } finally {
      setSubmitting(false);
    }
  };

  const handleReviewSwiftEdit = async (params: {
    requestId: string;
    decision: 'approve' | 'reject';
  }) => {
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiCall('swift', {
        method: 'POST',
        body: JSON.stringify({
          action: 'review-edit',
          requestId: params.requestId,
          decision: params.decision,
        }),
      });

      if (!result.success) {
        const message = getErrorMessage(result, tx('审批失败，请重试', 'Review failed, please retry.'));
        setError(message);
        alert(message);
        return false;
      }

      alert(result.message || tx('修改已完成', 'Update completed.'));
      await reloadSwiftViews();
      return true;
    } catch (err) {
      const message = getErrorMessage(err, tx('审批失败，请重试', 'Review failed, please retry.'));
      setError(message);
      alert(message);
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  return {
    uploading,
    submitting,
    handleFileSelect,
    handleConfirm,
    handleDeleteSwift,
    handleDirectCreate,
    handleSubmitSwiftEdit,
    handleReviewSwiftEdit,
  };
}
