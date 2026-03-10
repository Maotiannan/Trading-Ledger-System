'use client';

import { useEffect, useState } from 'react';
import { fetchServerDate } from '@/components/workspace/shared';
import { EMPTY_DETAIL_DIRECT_ITEM, type DetailDirectItemForm, type DetailOcrResult } from '../types';

export function useDetailForms() {
  const [showUpload, setShowUpload] = useState(false);
  const [showDirectCreate, setShowDirectCreate] = useState(false);
  const [ocrResult, setOcrResult] = useState<DetailOcrResult | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedImagePath, setSavedImagePath] = useState<{ path: string; name: string } | null>(null);
  const [directDate, setDirectDate] = useState('');
  const [directItems, setDirectItems] = useState<DetailDirectItemForm[]>([{ ...EMPTY_DETAIL_DIRECT_ITEM }]);
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(new Set());
  const [viewingImage, setViewingImage] = useState<{ url: string; name: string } | null>(null);

  useEffect(() => {
    if (!showDirectCreate) return;
    void fetchServerDate().then((serverDate) => {
      setDirectDate(serverDate);
    });
  }, [showDirectCreate]);

  const handleShowUploadChange = (open: boolean) => {
    setShowUpload(open);
    if (!open) {
      setError(null);
      setOcrResult(null);
      setImagePreview(null);
    }
  };

  const handleShowDirectCreateChange = (open: boolean) => {
    setShowDirectCreate(open);
  };

  const toggleDetail = (detailId: string) => {
    setExpandedDetails((prev) => {
      const next = new Set(prev);
      if (next.has(detailId)) {
        next.delete(detailId);
      } else {
        next.add(detailId);
      }
      return next;
    });
  };

  const resetDirectForm = () => {
    setDirectDate('');
    setDirectItems([{ ...EMPTY_DETAIL_DIRECT_ITEM }]);
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
    error,
    setError,
    savedImagePath,
    setSavedImagePath,
    directDate,
    setDirectDate,
    directItems,
    setDirectItems,
    expandedDetails,
    viewingImage,
    setViewingImage,
    handleShowUploadChange,
    handleShowDirectCreateChange,
    toggleDetail,
    resetDirectForm,
  };
}
