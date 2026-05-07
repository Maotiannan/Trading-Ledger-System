'use client';

import {
  apiUploadCall,
  classifyApiUploadError,
  getApiErrorCode,
  getApiErrorDetail,
  getApiErrorMessage,
  WorkspaceApiError,
  type ApiUploadOptions,
} from '@/components/workspace/api/client';
import type { UserImageCompressionPreference } from '@/components/workspace/modules/settings/types';

const DEFAULT_MAX_EDGE = 2200;
const DEFAULT_SKIP_COMPRESSION_BELOW_BYTES = 1_500_000;
const DEFAULT_TARGET_MAX_BYTES = 1_600 * 1024;
const DEFAULT_INITIAL_QUALITY = 0.92;
const DEFAULT_SCALE_REDUCTION_FACTOR = 0.85;
const MAX_SCALE_ATTEMPTS = 3;
const MAX_QUALITY_SEARCH_STEPS = 6;
const MIN_QUALITY_FLOOR = 0.3;

export type BusinessImageCompressionOptions = {
  preference?: Partial<UserImageCompressionPreference>;
  maxEdge?: number;
  targetMaxBytes?: number;
  skipCompressionBelowBytes?: number;
  initialQuality?: number;
  scaleReductionFactor?: number;
};

export type BusinessImageCompressionResult = {
  file: File;
  compressed: boolean;
  qualityUsed: number | null;
  originalSize: number;
  outputSize: number;
  targetMaxBytes: number;
};

export type BusinessImageUploadStage = 'compressing' | 'uploading' | 'saving' | 'success' | 'failed';

export type BusinessImageUploadFailureKind =
  | 'compression'
  | 'upload-idle-timeout'
  | 'upload-hard-timeout'
  | 'upload-aborted'
  | 'upload-error'
  | 'server-error';

export type BusinessImageUploadStageEvent = {
  stage: BusinessImageUploadStage;
  progress: number | null;
  compressed: boolean | null;
  preparedFile?: File;
  error?: unknown;
  response?: unknown;
  failureKind?: BusinessImageUploadFailureKind;
};

type UploadCallLike = typeof apiUploadCall;
type CompressFileLike = (
  file: File,
  options?: BusinessImageCompressionOptions,
) => Promise<BusinessImageCompressionResult>;

export type BusinessImageUploadOptions<TResponse = unknown> = {
  file: File;
  endpoint: string;
  method?: string;
  buildFormData?: (file: File) => FormData;
  compression?: BusinessImageCompressionOptions;
  idleTimeoutMs?: number;
  hardTimeoutMs?: number;
  onStageChange?: (event: BusinessImageUploadStageEvent) => void;
  uploadCall?: UploadCallLike;
  compressFile?: CompressFileLike;
  failureMessage?: string;
};

function replaceExtension(fileName: string, nextExtension: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot <= 0) return `${fileName}${nextExtension}`;
  return `${fileName.slice(0, lastDot)}${nextExtension}`;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

function clampQualityFloor(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return MIN_QUALITY_FLOOR;
  return Math.min(1, Math.max(MIN_QUALITY_FLOOR, Number(parsed.toFixed(2))));
}

function resolveCompressionPreference(
  preference: Partial<UserImageCompressionPreference> | undefined
): UserImageCompressionPreference {
  return {
    imageCompressionEnabled: preference?.imageCompressionEnabled ?? true,
    imageCompressionQualityFloor: clampQualityFloor(preference?.imageCompressionQualityFloor),
    ocrTargetMaxKb: Number.isInteger(preference?.ocrTargetMaxKb)
      ? Math.max(50, Number(preference?.ocrTargetMaxKb))
      : 500,
  };
}

function shouldTranscodeToJpeg(file: File): boolean {
  const mime = (file.type || '').toLowerCase();
  return mime === 'image/heic' || mime === 'image/heif';
}

function isImageUpload(file: File): boolean {
  return (file.type || '').toLowerCase().startsWith('image/');
}

function createCanvas(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  return canvas;
}

async function findBestJpegCandidate(
  canvas: HTMLCanvasElement,
  targetMaxBytes: number,
  qualityFloor: number,
  initialQuality: number
): Promise<{
  matched: { blob: Blob; quality: number } | null;
  fallback: { blob: Blob; quality: number } | null;
}> {
  let low = qualityFloor;
  let high = Math.max(low, Math.min(1, Number(initialQuality.toFixed(2))));
  let matched: { blob: Blob; quality: number } | null = null;
  let fallback: { blob: Blob; quality: number } | null = null;

  for (let step = 0; step < MAX_QUALITY_SEARCH_STEPS; step += 1) {
    const quality = Number((((low + high) / 2)).toFixed(2));
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    if (!blob) return { matched, fallback };
    if (!fallback || blob.size < fallback.blob.size) {
      fallback = { blob, quality };
    }
    if (blob.size <= targetMaxBytes) {
      matched = { blob, quality };
      low = quality;
    } else {
      high = quality;
    }
    if (high - low < 0.02) break;
  }

  if (matched) return { matched, fallback };

  const floorBlob = await canvasToBlob(canvas, 'image/jpeg', qualityFloor);
  if (floorBlob) {
    if (!fallback || floorBlob.size < fallback.blob.size) {
      fallback = { blob: floorBlob, quality: qualityFloor };
    }
    if (floorBlob.size <= targetMaxBytes) {
      return {
        matched: { blob: floorBlob, quality: qualityFloor },
        fallback,
      };
    }
  }

  return { matched: null, fallback };
}

function reportStage(
  onStageChange: ((event: BusinessImageUploadStageEvent) => void) | undefined,
  event: BusinessImageUploadStageEvent
) {
  onStageChange?.(event);
}

function isResponseFailure(response: unknown): boolean {
  return Boolean(
    response
    && typeof response === 'object'
    && 'success' in (response as Record<string, unknown>)
    && (response as { success?: unknown }).success === false
  );
}

function mapUploadFailureKind(error: unknown): BusinessImageUploadFailureKind {
  const kind = classifyApiUploadError(error);
  if (kind === 'idle-timeout') return 'upload-idle-timeout';
  if (kind === 'hard-timeout') return 'upload-hard-timeout';
  if (kind === 'aborted') return 'upload-aborted';
  if (error instanceof WorkspaceApiError) return 'server-error';
  return 'upload-error';
}

export async function compressBusinessImage(
  file: File,
  options: BusinessImageCompressionOptions = {}
): Promise<BusinessImageCompressionResult> {
  const preference = resolveCompressionPreference(options.preference);
  const targetMaxBytes = options.targetMaxBytes ?? Math.max(50 * 1024, preference.ocrTargetMaxKb * 1024);
  const skipCompressionBelowBytes = options.skipCompressionBelowBytes ?? DEFAULT_SKIP_COMPRESSION_BELOW_BYTES;
  const shouldForceJpeg = shouldTranscodeToJpeg(file);
  const compressionDisabled = !preference.imageCompressionEnabled;

  if (
    !isImageUpload(file)
    ||
    (compressionDisabled && !shouldForceJpeg)
    || typeof window === 'undefined'
    || typeof document === 'undefined'
    || typeof createImageBitmap !== 'function'
    || (file.size <= skipCompressionBelowBytes && file.size <= targetMaxBytes && !shouldForceJpeg)
  ) {
    return {
      file,
      compressed: false,
      qualityUsed: null,
      originalSize: file.size,
      outputSize: file.size,
      targetMaxBytes,
    };
  }

  const bitmap = await createImageBitmap(file);
  try {
    const maxEdge = options.maxEdge ?? DEFAULT_MAX_EDGE;
    const reductionFactor = options.scaleReductionFactor ?? DEFAULT_SCALE_REDUCTION_FACTOR;
    const initialScale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    let width = Math.max(1, Math.round(bitmap.width * initialScale));
    let height = Math.max(1, Math.round(bitmap.height * initialScale));
    let bestEffortJpeg: { blob: Blob; quality: number } | null = null;

    for (let attempt = 0; attempt < MAX_SCALE_ATTEMPTS; attempt += 1) {
      const canvas = createCanvas(width, height);
      if (!canvas) break;
      const context = canvas.getContext('2d');
      if (!context) break;
      context.drawImage(bitmap, 0, 0, width, height);

      const candidate = await findBestJpegCandidate(
        canvas,
        targetMaxBytes,
        preference.imageCompressionQualityFloor,
        options.initialQuality ?? DEFAULT_INITIAL_QUALITY,
      );

      if (
        candidate.fallback
        && (!bestEffortJpeg || candidate.fallback.blob.size < bestEffortJpeg.blob.size)
      ) {
        bestEffortJpeg = candidate.fallback;
      }

      if (candidate.matched) {
        const compressedFile = new File([candidate.matched.blob], replaceExtension(file.name, '.jpg'), {
          type: 'image/jpeg',
        });
        if (shouldForceJpeg || compressedFile.size < file.size) {
          return {
            file: compressedFile,
            compressed: true,
            qualityUsed: candidate.matched.quality,
            originalSize: file.size,
            outputSize: compressedFile.size,
            targetMaxBytes,
          };
        }
      }

      width = Math.max(1, Math.round(width * reductionFactor));
      height = Math.max(1, Math.round(height * reductionFactor));
    }

    if (bestEffortJpeg && (shouldForceJpeg || bestEffortJpeg.blob.size < file.size)) {
      const normalizedFile = new File([bestEffortJpeg.blob], replaceExtension(file.name, '.jpg'), {
        type: 'image/jpeg',
      });
      return {
        file: normalizedFile,
        compressed: true,
        qualityUsed: bestEffortJpeg.quality,
        originalSize: file.size,
        outputSize: normalizedFile.size,
        targetMaxBytes,
      };
    }

    return {
      file,
      compressed: false,
      qualityUsed: null,
      originalSize: file.size,
      outputSize: file.size,
      targetMaxBytes,
    };
  } finally {
    if (typeof bitmap.close === 'function') {
      bitmap.close();
    }
  }
}

export async function uploadBusinessImage<TResponse = unknown>({
  file,
  endpoint,
  method = 'POST',
  buildFormData,
  compression,
  idleTimeoutMs,
  hardTimeoutMs,
  onStageChange,
  uploadCall = apiUploadCall,
  compressFile = compressBusinessImage,
  failureMessage = 'Image upload failed',
}: BusinessImageUploadOptions<TResponse>): Promise<{
  prepared: BusinessImageCompressionResult;
  response: TResponse;
}> {
  reportStage(onStageChange, {
    stage: 'compressing',
    progress: null,
    compressed: null,
  });

  let prepared: BusinessImageCompressionResult;
  try {
    prepared = await compressFile(file, compression);
  } catch (error) {
    reportStage(onStageChange, {
      stage: 'failed',
      progress: null,
      compressed: null,
      error,
      failureKind: 'compression',
    });
    throw error;
  }

  reportStage(onStageChange, {
    stage: 'uploading',
    progress: 0,
    compressed: prepared.compressed,
    preparedFile: prepared.file,
  });

  let failureReported = false;

  try {
    const formData = buildFormData ? buildFormData(prepared.file) : new FormData();
    if (!buildFormData) {
      formData.append('file', prepared.file);
    }

    const response = await uploadCall(endpoint, formData, {
      method,
      idleTimeoutMs,
      hardTimeoutMs,
      onUploadProgress: ({ percent }) => {
        if (typeof percent !== 'number') return;
        reportStage(onStageChange, {
          stage: 'uploading',
          progress: percent,
          compressed: prepared.compressed,
          preparedFile: prepared.file,
        });
      },
      onUploadStageChange: (stage) => {
        if (stage !== 'saving') return;
        reportStage(onStageChange, {
          stage: 'saving',
          progress: 100,
          compressed: prepared.compressed,
          preparedFile: prepared.file,
        });
      },
    } satisfies ApiUploadOptions) as TResponse;

    if (isResponseFailure(response)) {
      const error = new WorkspaceApiError(getApiErrorMessage(response, failureMessage), {
        code: getApiErrorCode(response),
        detail: getApiErrorDetail(response),
      });
      failureReported = true;
      reportStage(onStageChange, {
        stage: 'failed',
        progress: null,
        compressed: prepared.compressed,
        preparedFile: prepared.file,
        error,
        response,
        failureKind: 'server-error',
      });
      throw error;
    }

    reportStage(onStageChange, {
      stage: 'success',
      progress: 100,
      compressed: prepared.compressed,
      preparedFile: prepared.file,
      response,
    });

    return {
      prepared,
      response,
    };
  } catch (error) {
    if (!failureReported) {
      reportStage(onStageChange, {
        stage: 'failed',
        progress: null,
        compressed: prepared.compressed,
        preparedFile: prepared.file,
        error,
        failureKind: mapUploadFailureKind(error),
      });
    }
    throw error;
  }
}
