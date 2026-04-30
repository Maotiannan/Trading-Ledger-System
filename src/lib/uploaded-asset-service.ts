import {
  UploadedAssetAttachmentType,
  UploadedAssetCategory,
  UploadedAssetStatus,
} from '@prisma/client';
import { db } from '@/lib/db';

export async function registerUploadedAsset(input: {
  path: string;
  name: string;
  category: UploadedAssetCategory;
  mimeType: string;
  sizeBytes: number;
  createdBy: string;
  expiresAt: Date | null;
}) {
  return db.uploadedAsset.create({
    data: {
      path: input.path,
      name: input.name,
      category: input.category,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      createdBy: input.createdBy,
      status: UploadedAssetStatus.STAGED,
      expiresAt: input.expiresAt,
    },
  });
}

export async function attachUploadedAssetByPath(input: {
  path: string;
  attachedType: UploadedAssetAttachmentType;
  attachedId: string;
}) {
  await db.uploadedAsset.updateMany({
    where: {
      path: input.path,
      status: UploadedAssetStatus.STAGED,
    },
    data: {
      status: UploadedAssetStatus.ATTACHED,
      attachedType: input.attachedType,
      attachedId: input.attachedId,
      expiresAt: null,
    },
  });
}

export function uploadedAssetSubDirForCategory(category: UploadedAssetCategory): string {
  switch (category) {
    case UploadedAssetCategory.RECEIPT_DIRECT:
      return 'receipts/direct';
    case UploadedAssetCategory.RECEIPT_OCR:
      return 'receipts/ocr';
    case UploadedAssetCategory.DETAIL_OCR:
      return 'details/ocr';
    case UploadedAssetCategory.SWIFT_OCR:
      return 'swifts/ocr';
    case UploadedAssetCategory.RECEIPT_GENERATOR_FINAL:
      return 'receipts/generated';
    case UploadedAssetCategory.RECEIPT_GENERATOR_SIGNATURE:
      return 'receipts/generated/signatures';
  }

  const exhaustiveCheck: never = category;
  throw new Error(`Unsupported uploaded asset category: ${exhaustiveCheck}`);
}
