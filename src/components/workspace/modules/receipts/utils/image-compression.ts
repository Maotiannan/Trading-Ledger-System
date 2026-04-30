'use client';

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

export async function compressReceiptDirectImage(file: File): Promise<{
  file: File;
  compressed: boolean;
  qualityUsed: number | null;
}> {
  const shouldSkip = file.size <= 1_500_000 && file.type !== 'image/heic' && file.type !== 'image/heif';
  if (shouldSkip || typeof window === 'undefined' || typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    return { file, compressed: false, qualityUsed: null };
  }

  const bitmap = await createImageBitmap(file);
  try {
    const maxEdge = 2200;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return { file, compressed: false, qualityUsed: null };
    context.drawImage(bitmap, 0, 0, width, height);

    let quality = 0.78;
    let blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    while (blob && blob.size > 1_600_000 && quality > 0.30) {
      quality = Math.max(0.30, Number((quality - 0.08).toFixed(2)));
      blob = await canvasToBlob(canvas, 'image/jpeg', quality);
      if (quality === 0.30) break;
    }

    if (!blob) return { file, compressed: false, qualityUsed: null };
    const compressedFile = new File([blob], replaceExtension(file.name, '.jpg'), { type: 'image/jpeg' });
    if (compressedFile.size >= file.size) {
      return { file, compressed: false, qualityUsed: null };
    }
    return { file: compressedFile, compressed: true, qualityUsed: quality };
  } finally {
    if (typeof bitmap.close === 'function') {
      bitmap.close();
    }
  }
}
