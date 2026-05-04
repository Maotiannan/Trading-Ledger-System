'use client';

import { useState } from 'react';
import { apiCall, getApiErrorMessage, getErrorMessage } from '@/components/workspace/shared';
import { uploadBusinessImage, type BusinessImageUploadStageEvent } from '@/components/workspace/modules/shared/business-image-upload';
import type { UserImageCompressionPreference } from '@/components/workspace/modules/settings/types';
import type { DetailDirectItemForm, DetailOcrResult, DetailOcrUploadStatus } from '../types';

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
  setOcrUploadStatus: (value: DetailOcrUploadStatus) => void;
  setOcrUploadMessage: (value: string | null) => void;
  setOcrUploadProgress: (value: number | null) => void;
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
  setOcrUploadStatus,
  setOcrUploadMessage,
  setOcrUploadProgress,
  handleShowUploadChange,
  handleShowDirectCreateChange,
  resetDirectForm,
}: DetailActionDeps) {
  const OCR_UPLOAD_IDLE_TIMEOUT_MS = 15_000;
  const OCR_UPLOAD_HARD_TIMEOUT_MS = 120_000;
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const resetOcrRecognitionState = () => {
    setOcrResult(null);
    setSavedImagePath(null);
  };

  const buildOcrUploadMessage = (event: Pick<BusinessImageUploadStageEvent, 'stage' | 'progress' | 'compressed'>) => {
    switch (event.stage) {
      case 'compressing':
        return tx('正在压缩图片...', 'Compressing image...');
      case 'uploading': {
        const percent = typeof event.progress === 'number' ? event.progress : 0;
        return event.compressed
          ? tx(`正在上传压缩后的图片（${percent}%）...`, `Uploading compressed image (${percent}%)...`)
          : tx(`正在上传图片（${percent}%）...`, `Uploading image (${percent}%)...`);
      }
      case 'saving':
        return tx('图片已上传，AI正在识别...', 'Image uploaded. AI is recognizing...');
      case 'success':
        return tx('AI识别完成', 'AI recognition completed.');
      case 'failed':
        return null;
      default:
        return null;
    }
  };

  const applyOcrUploadStage = (
    event: Pick<BusinessImageUploadStageEvent, 'stage' | 'progress' | 'compressed'>,
    failureMessage?: string
  ) => {
    setOcrUploadStatus(event.stage);
    if (event.stage === 'failed') {
      setOcrUploadMessage(failureMessage ?? null);
      setOcrUploadProgress(null);
      return;
    }
    setOcrUploadMessage(buildOcrUploadMessage(event));
    if (event.stage === 'saving' || event.stage === 'success') {
      setOcrUploadProgress(100);
      return;
    }
    setOcrUploadProgress(typeof event.progress === 'number' ? event.progress : null);
  };

  const loadUserCompressionPreference = async (): Promise<Partial<UserImageCompressionPreference> | undefined> => {
    try {
      const result = await apiCall('settings?view=user-preferences');
      if (!result?.success || !result.data || typeof result.data !== 'object') {
        return undefined;
      }
      return result.data as Partial<UserImageCompressionPreference>;
    } catch {
      return undefined;
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const input = event.target;

    setSelectedFile(file);
    setUploading(true);
    setError(null);
    resetOcrRecognitionState();
    applyOcrUploadStage({
      stage: 'compressing',
      progress: null,
      compressed: null,
    });

    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);

    try {
      const preference = await loadUserCompressionPreference();
      const { response } = await uploadBusinessImage<{
        success?: boolean;
        data?: {
          ocrResult?: DetailOcrResult | null;
          image?: { path: string; name: string } | null;
        };
      }>({
        file,
        endpoint: 'detail',
        buildFormData: (preparedFile) => {
          const formData = new FormData();
          formData.append('file', preparedFile);
          formData.append('action', 'recognize');
          return formData;
        },
        compression: {
          preference,
        },
        idleTimeoutMs: OCR_UPLOAD_IDLE_TIMEOUT_MS,
        hardTimeoutMs: OCR_UPLOAD_HARD_TIMEOUT_MS,
        failureMessage: tx('AI识别失败，请重试', 'AI recognition failed, please retry.'),
        onStageChange: (stageEvent) => {
          if (stageEvent.stage === 'failed') {
            applyOcrUploadStage(
              stageEvent,
              getApiErrorMessage(stageEvent.error, tx('AI识别失败，请重试', 'AI recognition failed, please retry.'))
            );
            return;
          }
          applyOcrUploadStage(stageEvent);
        },
      });

      setOcrResult(response.data?.ocrResult || null);
      setSavedImagePath(response.data?.image || null);
      applyOcrUploadStage({
        stage: 'success',
        progress: 100,
        compressed: null,
      });
    } catch (err) {
      const message = getApiErrorMessage(err, tx('AI识别失败，请重试', 'AI recognition failed, please retry.'));
      applyOcrUploadStage({
        stage: 'failed',
        progress: null,
        compressed: null,
      }, message);
      resetOcrRecognitionState();
      setError(message);
    } finally {
      input.value = '';
      setUploading(false);
    }
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
        setError(getErrorMessage(result, tx('创建失败，请重试', 'Create failed, please retry.')));
      }
    } catch (err) {
      console.error('Confirm error:', err);
      setError(getErrorMessage(err, tx('网络错误，请重试', 'Network error, please retry.')));
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
      alert(getErrorMessage(result, tx('申请失败', 'Request failed')));
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
        setError(getErrorMessage(result, tx('创建失败', 'Create failed')));
      }
    } catch (err) {
      setError(getErrorMessage(err, tx('创建失败', 'Create failed')));
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
