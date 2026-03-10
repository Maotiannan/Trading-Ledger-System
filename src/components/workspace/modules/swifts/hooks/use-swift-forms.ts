'use client';

import { useEffect, useState } from 'react';
import { fetchServerDate } from '@/components/workspace/shared';
import { EMPTY_SWIFT_DIRECT_FORM, type SwiftDirectForm, type SwiftOcrResult } from '../types';

export function useSwiftForms() {
  const [showUpload, setShowUpload] = useState(false);
  const [showDirectCreate, setShowDirectCreate] = useState(false);
  const [ocrResult, setOcrResult] = useState<SwiftOcrResult | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [savedImagePath, setSavedImagePath] = useState<{ path: string; name: string } | null>(null);
  const [viewingImage, setViewingImage] = useState<{ url: string; name: string } | null>(null);
  const [selectedDetailId, setSelectedDetailId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [directForm, setDirectForm] = useState<SwiftDirectForm>({ ...EMPTY_SWIFT_DIRECT_FORM });

  useEffect(() => {
    if (!showDirectCreate) return;
    void fetchServerDate().then((serverDate) => {
      setDirectForm((prev) => ({ ...prev, date: serverDate }));
    });
  }, [showDirectCreate]);

  const handleShowUploadChange = (open: boolean) => {
    setShowUpload(open);
    if (!open) {
      setError(null);
      setOcrResult(null);
      setImagePreview(null);
      setSavedImagePath(null);
      setSelectedDetailId('');
    }
  };

  const handleShowDirectCreateChange = (open: boolean) => {
    setShowDirectCreate(open);
  };

  const resetDirectForm = () => {
    setDirectForm({ ...EMPTY_SWIFT_DIRECT_FORM });
  };

  return {
    showUpload,
    showDirectCreate,
    ocrResult,
    setOcrResult,
    imagePreview,
    setImagePreview,
    selectedFile,
    setSelectedFile,
    savedImagePath,
    setSavedImagePath,
    viewingImage,
    setViewingImage,
    selectedDetailId,
    setSelectedDetailId,
    error,
    setError,
    directForm,
    setDirectForm,
    handleShowUploadChange,
    handleShowDirectCreateChange,
    resetDirectForm,
  };
}
