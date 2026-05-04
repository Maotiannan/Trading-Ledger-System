import { WorkspaceApiError, type ApiUploadOptions } from '@/components/workspace/api/client';
import { compressBusinessImage, uploadBusinessImage } from './business-image-upload';

describe('business-image-upload', () => {
  const originalCreateImageBitmap = global.createImageBitmap;
  const originalCreateElement = document.createElement.bind(document);

  afterEach(() => {
    global.createImageBitmap = originalCreateImageBitmap;
    document.createElement = originalCreateElement;
    jest.restoreAllMocks();
  });

  it('keeps the original file when client-side compression is disabled by preference', async () => {
    const file = new File([new Uint8Array(200_000)], 'receipt.jpg', { type: 'image/jpeg' });

    const result = await compressBusinessImage(file, {
      preference: {
        imageCompressionEnabled: false,
        imageCompressionQualityFloor: 0.45,
        ocrTargetMaxKb: 640,
      },
    });

    expect(result.file).toBe(file);
    expect(result.compressed).toBe(false);
    expect(result.qualityUsed).toBeNull();
  });

  it('still normalizes HEIC uploads to jpeg when client-side compression is disabled by preference', async () => {
    const file = new File([new Uint8Array(200_000)], 'receipt.heic', { type: 'image/heic' });
    const bitmapClose = jest.fn();
    global.createImageBitmap = jest.fn().mockResolvedValue({
      width: 3024,
      height: 4032,
      close: bitmapClose,
    });

    const toBlob = jest.fn((callback: BlobCallback) => {
      callback(new Blob([new Uint8Array(300_000)], { type: 'image/jpeg' }));
    });

    document.createElement = jest.fn((tagName: string) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: jest.fn(() => ({ drawImage: jest.fn() })),
          toBlob,
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tagName);
    }) as typeof document.createElement;

    const result = await compressBusinessImage(file, {
      preference: {
        imageCompressionEnabled: false,
        imageCompressionQualityFloor: 0.45,
        ocrTargetMaxKb: 640,
      },
    });

    expect(global.createImageBitmap).toHaveBeenCalledWith(file);
    expect(result.file).not.toBe(file);
    expect(result.file.type).toBe('image/jpeg');
    expect(result.file.name).toBe('receipt.jpg');
    expect(result.compressed).toBe(true);
    expect(result.qualityUsed).not.toBeNull();
    expect(bitmapClose).toHaveBeenCalled();
  });

  it('searches for a jpeg quality that satisfies the target byte budget', async () => {
    const file = new File([new Uint8Array(4_000_000)], 'receipt.png', { type: 'image/png' });
    const bitmapClose = jest.fn();
    global.createImageBitmap = jest.fn().mockResolvedValue({
      width: 4032,
      height: 3024,
      close: bitmapClose,
    });

    const toBlob = jest.fn((_callback: BlobCallback, _type?: string, quality?: number) => {
      const q = Number((quality ?? 0).toFixed(2));
      const size = q >= 0.8
        ? 2_100_000
        : q >= 0.65
          ? 1_550_000
          : 1_100_000;
      _callback(new Blob([new Uint8Array(size)], { type: 'image/jpeg' }));
    });

    document.createElement = jest.fn((tagName: string) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: jest.fn(() => ({ drawImage: jest.fn() })),
          toBlob,
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tagName);
    }) as typeof document.createElement;

    const result = await compressBusinessImage(file, {
      preference: {
        imageCompressionEnabled: true,
        imageCompressionQualityFloor: 0.3,
        ocrTargetMaxKb: 1600,
      },
    });

    expect(result.compressed).toBe(true);
    expect(result.file.type).toBe('image/jpeg');
    expect(result.file.size).toBeLessThanOrEqual(1_600 * 1024);
    expect(result.qualityUsed).not.toBeNull();
    expect(toBlob.mock.calls.length).toBeGreaterThan(2);
    expect(bitmapClose).toHaveBeenCalled();
  });

  it('still compresses when the file is below the weak-network threshold but above the configured target size', async () => {
    const file = new File([new Uint8Array(1_000_000)], 'receipt.png', { type: 'image/png' });
    global.createImageBitmap = jest.fn().mockResolvedValue({
      width: 2400,
      height: 1800,
      close: jest.fn(),
    });

    const toBlob = jest.fn((callback: BlobCallback) => {
      callback(new Blob([new Uint8Array(350_000)], { type: 'image/jpeg' }));
    });

    document.createElement = jest.fn((tagName: string) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: jest.fn(() => ({ drawImage: jest.fn() })),
          toBlob,
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tagName);
    }) as typeof document.createElement;

    const result = await compressBusinessImage(file, {
      preference: {
        imageCompressionEnabled: true,
        imageCompressionQualityFloor: 0.3,
        ocrTargetMaxKb: 500,
      },
    });

    expect(result.compressed).toBe(true);
    expect(result.file.size).toBe(350_000);
    expect(toBlob).toHaveBeenCalled();
  });

  it('still normalizes HEIC uploads to jpeg when no candidate satisfies the target byte budget', async () => {
    const file = new File([new Uint8Array(200_000)], 'receipt.heic', { type: 'image/heic' });
    const bitmapClose = jest.fn();
    global.createImageBitmap = jest.fn().mockResolvedValue({
      width: 3024,
      height: 4032,
      close: bitmapClose,
    });

    const toBlob = jest.fn((callback: BlobCallback, _type?: string, quality?: number) => {
      const q = Number((quality ?? 0).toFixed(2));
      const size = q <= 0.3 ? 260_000 : 320_000;
      callback(new Blob([new Uint8Array(size)], { type: 'image/jpeg' }));
    });

    document.createElement = jest.fn((tagName: string) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: jest.fn(() => ({ drawImage: jest.fn() })),
          toBlob,
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tagName);
    }) as typeof document.createElement;

    const result = await compressBusinessImage(file, {
      targetMaxBytes: 180_000,
      preference: {
        imageCompressionEnabled: false,
        imageCompressionQualityFloor: 0.3,
        ocrTargetMaxKb: 500,
      },
    });

    expect(result.file).not.toBe(file);
    expect(result.file.type).toBe('image/jpeg');
    expect(result.file.name).toBe('receipt.jpg');
    expect(result.file.size).toBeGreaterThan(180_000);
    expect(result.compressed).toBe(true);
    expect(result.qualityUsed).not.toBeNull();
    expect(bitmapClose).toHaveBeenCalled();
  });

  it('reports business upload stages and reuses the prepared jpeg file', async () => {
    const originalFile = new File(['raw'], 'receipt.png', { type: 'image/png' });
    const preparedFile = new File(['jpeg'], 'receipt.jpg', { type: 'image/jpeg' });
    const stageSpy = jest.fn();
    const uploadCall = jest.fn(async (_endpoint: string, formData: FormData, options?: ApiUploadOptions) => {
      expect(formData.get('action')).toBe('upload');
      expect(formData.get('file')).toBe(preparedFile);
      options?.onUploadProgress?.({ loaded: 25, total: 100, percent: 25 });
      options?.onUploadStageChange?.('saving');
      return { success: true, data: { path: '/upload/receipt.jpg', name: 'receipt.jpg' } };
    });

    const result = await uploadBusinessImage({
      file: originalFile,
      endpoint: 'upload-image',
      buildFormData: (file) => {
        const formData = new FormData();
        formData.append('action', 'upload');
        formData.append('file', file);
        return formData;
      },
      onStageChange: stageSpy,
      compressFile: async () => ({
        file: preparedFile,
        compressed: true,
        qualityUsed: 0.65,
        originalSize: originalFile.size,
        outputSize: preparedFile.size,
        targetMaxBytes: 1_600 * 1024,
      }),
      uploadCall,
    });

    expect(result).toEqual({
      prepared: {
        file: preparedFile,
        compressed: true,
        qualityUsed: 0.65,
        originalSize: originalFile.size,
        outputSize: preparedFile.size,
        targetMaxBytes: 1_600 * 1024,
      },
      response: { success: true, data: { path: '/upload/receipt.jpg', name: 'receipt.jpg' } },
    });
    expect(stageSpy.mock.calls.map(([event]) => ({
      stage: event.stage,
      progress: event.progress,
      compressed: event.compressed,
      failureKind: event.failureKind ?? null,
    }))).toEqual([
      { stage: 'compressing', progress: null, compressed: null, failureKind: null },
      { stage: 'uploading', progress: 0, compressed: true, failureKind: null },
      { stage: 'uploading', progress: 25, compressed: true, failureKind: null },
      { stage: 'saving', progress: 100, compressed: true, failureKind: null },
      { stage: 'success', progress: 100, compressed: true, failureKind: null },
    ]);
  });

  it('maps upload idle timeout errors into a failed business upload stage', async () => {
    const timeoutError = new WorkspaceApiError('Upload stalled for too long. Check your network and retry.', {
      code: 'UPLOAD_IDLE_TIMEOUT',
    });
    const stageSpy = jest.fn();

    await expect(uploadBusinessImage({
      file: new File(['raw'], 'receipt.png', { type: 'image/png' }),
      endpoint: 'upload-image',
      onStageChange: stageSpy,
      compressFile: async (file) => ({
        file,
        compressed: false,
        qualityUsed: null,
        originalSize: file.size,
        outputSize: file.size,
        targetMaxBytes: 1_600 * 1024,
      }),
      uploadCall: async () => {
        throw timeoutError;
      },
    })).rejects.toBe(timeoutError);

    expect(stageSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      stage: 'failed',
      failureKind: 'upload-idle-timeout',
      error: timeoutError,
    }));
  });

  it('maps non-2xx upload api failures into a server-error stage', async () => {
    const serverError = new WorkspaceApiError('Validation failed', {
      code: 'BAD_REQUEST',
      status: 400,
      detail: { field: 'file' },
    });
    const stageSpy = jest.fn();

    await expect(uploadBusinessImage({
      file: new File(['raw'], 'receipt.png', { type: 'image/png' }),
      endpoint: 'upload-image',
      onStageChange: stageSpy,
      compressFile: async (file) => ({
        file,
        compressed: false,
        qualityUsed: null,
        originalSize: file.size,
        outputSize: file.size,
        targetMaxBytes: 1_600 * 1024,
      }),
      uploadCall: async () => {
        throw serverError;
      },
    })).rejects.toBe(serverError);

    expect(stageSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      stage: 'failed',
      failureKind: 'server-error',
      error: serverError,
    }));
  });

  it('emits a failed stage when buildFormData throws synchronously after upload stage begins', async () => {
    const originalFile = new File(['raw'], 'receipt.png', { type: 'image/png' });
    const preparedFile = new File(['jpeg'], 'receipt.jpg', { type: 'image/jpeg' });
    const stageSpy = jest.fn();
    const syncError = new Error('FormData construction failed');

    await expect(uploadBusinessImage({
      file: originalFile,
      endpoint: 'upload-image',
      buildFormData: () => {
        throw syncError;
      },
      onStageChange: stageSpy,
      compressFile: async () => ({
        file: preparedFile,
        compressed: true,
        qualityUsed: 0.65,
        originalSize: originalFile.size,
        outputSize: preparedFile.size,
        targetMaxBytes: 1_600 * 1024,
      }),
      uploadCall: jest.fn(),
    })).rejects.toBe(syncError);

    expect(stageSpy.mock.calls.map(([event]) => ({
      stage: event.stage,
      compressed: event.compressed,
      failureKind: event.failureKind ?? null,
      error: event.error ?? null,
    }))).toEqual([
      { stage: 'compressing', compressed: null, failureKind: null, error: null },
      { stage: 'uploading', compressed: true, failureKind: null, error: null },
      { stage: 'failed', compressed: true, failureKind: 'upload-error', error: syncError },
    ]);
  });
});
