'use client';

import { compressBusinessImage } from '@/components/workspace/modules/shared/business-image-upload';

export async function compressReceiptDirectImage(file: File): Promise<{
  file: File;
  compressed: boolean;
  qualityUsed: number | null;
}> {
  const result = await compressBusinessImage(file, {
    targetMaxBytes: 1_600 * 1024,
    skipCompressionBelowBytes: 1_500_000,
    maxEdge: 2200,
  });
  return {
    file: result.file,
    compressed: result.compressed,
    qualityUsed: result.qualityUsed,
  };
}
