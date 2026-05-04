'use client';

import { useState } from 'react';
import { apiCall, apiUploadCall, getApiErrorMessage, getErrorMessage } from '@/components/workspace/shared';
import { uploadBusinessImage, type BusinessImageUploadStageEvent } from '@/components/workspace/modules/shared/business-image-upload';
import type { UserImageCompressionPreference } from '@/components/workspace/modules/settings/types';
import { compressReceiptDirectImage } from '../utils/image-compression';
import type { PendingDirectImageSelection, ReceiptDirectForm } from '../types';

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
  pendingDirectImageSelection: PendingDirectImageSelection | null;
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
  setPendingDirectImageSelection: (value: PendingDirectImageSelection | null) => void;
  setOcrUploadStatus: (value: 'idle' | 'compressing' | 'uploading' | 'saving' | 'success' | 'failed') => void;
  setOcrUploadMessage: (value: string | null) => void;
  setOcrUploadProgress: (value: number | null) => void;
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
  pendingDirectImageSelection,
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
  setPendingDirectImageSelection,
  setOcrUploadStatus,
  setOcrUploadMessage,
  setOcrUploadProgress,
  setDirectUploadStatus,
  setDirectUploadMessage,
  setDirectUploadProgress,
  setError,
  handleShowUploadChange,
  handleShowDirectCreateChange,
  resetDirectForm,
}: ReceiptActionDeps) {
  const USER_PREFERENCE_SOFT_TIMEOUT_MS = 1_500;
  const OCR_UPLOAD_IDLE_TIMEOUT_MS = 15_000;
  const OCR_UPLOAD_HARD_TIMEOUT_MS = 120_000;
  const DIRECT_UPLOAD_IDLE_TIMEOUT_MS = 15_000;
  const DIRECT_UPLOAD_HARD_TIMEOUT_MS = 120_000;
  const [uploading, setUploading] = useState(false);
  const [directUploading, setDirectUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(tx('图片预览读取失败，请重试', 'Failed to read image preview. Please retry.')));
    reader.readAsDataURL(file);
  });

  const resetOcrRecognitionState = () => {
    setOcrResult(null);
    setSavedImagePath(null);
    setOcrCustomerMark('');
    setOcrCustomerName('');
    setOcrCustomerId('');
    setOcrCustomerCandidates([]);
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

  const applyOcrUploadStage = (event: Pick<BusinessImageUploadStageEvent, 'stage' | 'progress' | 'compressed'>, failureMessage?: string) => {
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

  const resolveWithSoftTimeout = <T,>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> => new Promise((resolve) => {
    const timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      () => {
        clearTimeout(timeoutId);
        resolve(fallback);
      }
    );
  });

  const loadUserCompressionPreference = async (): Promise<Partial<UserImageCompressionPreference> | undefined> => {
    const result = await resolveWithSoftTimeout(
      apiCall('settings?view=user-preferences'),
      USER_PREFERENCE_SOFT_TIMEOUT_MS,
      undefined
    );
    if (!result?.success || !result.data || typeof result.data !== 'object') {
      return undefined;
    }
    return result.data as Partial<UserImageCompressionPreference>;
  };

  const isReceiptOcrResult = (value: unknown): value is Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const candidate = value as Record<string, unknown>;
    const recognizedKeys = ['receiptNo', 'date', 'usd', 'orderNo', 'invNo', 'payer', 'isDeposit'] as const;
    const presentRecognizedKeys = recognizedKeys.filter((key) => candidate[key] !== undefined);
    if (presentRecognizedKeys.length === 0) {
      return false;
    }

    return presentRecognizedKeys.every((key) => {
      const field = candidate[key];
      switch (key) {
        case 'usd':
          return typeof field === 'number' && Number.isFinite(field);
        case 'isDeposit':
          return typeof field === 'boolean';
        default:
          return field === null || typeof field === 'string';
      }
    });
  };

  const getSuccessfulOcrPayload = (
    response: {
      success?: boolean;
      data?: {
        ocrResult?: Record<string, unknown> | null;
        image?: { path: string; name: string } | null;
      };
    },
    invalidPayloadMessage: string
  ) => {
    if (!response.success || !isReceiptOcrResult(response.data?.ocrResult)) {
      throw new Error(invalidPayloadMessage);
    }

    return {
      ocrResult: response.data.ocrResult,
      image: response.data?.image ?? null,
    };
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
      const invalidPayloadMessage = tx('AI识别结果无效，请重试', 'AI returned an invalid recognition result. Please retry.');
      const preference = await loadUserCompressionPreference();
      const { response } = await uploadBusinessImage<{
        success?: boolean;
        data?: {
          ocrResult?: Record<string, unknown> | null;
          image?: { path: string; name: string } | null;
        };
      }>({
        file,
        endpoint: 'receipt',
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
            applyOcrUploadStage(stageEvent, getApiErrorMessage(
              stageEvent.error,
              tx('AI识别失败，请重试', 'AI recognition failed, please retry.'),
            ));
            return;
          }
          applyOcrUploadStage(stageEvent);
        },
      });

      const successfulPayload = getSuccessfulOcrPayload(response, invalidPayloadMessage);
      setOcrResult(successfulPayload.ocrResult);
      setSavedImagePath(successfulPayload.image);
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
      setSavedImagePath(null);
      setError(message);
    } finally {
      input.value = '';
      setUploading(false);
    }
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

    setError(null);
    try {
      const previewUrl = await readFileAsDataUrl(file);
      setPendingDirectImageSelection({
        file,
        previewUrl,
        name: file.name,
      });
      setDirectUploadStatus('idle');
      setDirectUploadMessage(null);
      setDirectUploadProgress(null);
    } catch (err) {
      const message = getErrorMessage(err, tx('图片压缩失败，请重试', 'Image compression failed, please retry.'));
      setError(message);
    }
    event.target.value = '';
  };

  const handleConfirmDirectImageUpload = async () => {
    if (!pendingDirectImageSelection) return;

    setDirectUploading(true);
    setError(null);
    setDirectUploadStatus('compressing');
    setDirectUploadMessage(tx('正在压缩图片...', 'Compressing image...'));
    setDirectUploadProgress(null);

    let uploadFile = pendingDirectImageSelection.file;
    try {
      const prepared = await compressReceiptDirectImage(pendingDirectImageSelection.file);
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
        setPendingDirectImageSelection(null);
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
    handleConfirmDirectImageUpload,
    handleMarkReceived,
    handleDirectCreate,
    handleDeleteReceipt,
  };
}
