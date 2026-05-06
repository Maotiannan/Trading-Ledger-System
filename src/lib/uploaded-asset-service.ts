import {
  UploadedAssetAttachmentType,
  UploadedAssetCategory,
  UploadedAssetStatus,
} from '@prisma/client';
import { rm } from 'fs/promises';
import path from 'path';
import { addHours } from 'date-fns';
import { db } from '@/lib/db';
import { getUploadedAssetCleanupSettings } from '@/lib/system-settings';
import { saveUploadedFile, saveUploadedImage } from '@/lib/upload';

const DEFAULT_UPLOAD_DIR = '/app/upload/images';
const DEFAULT_UPLOAD_PUBLIC_PATH = '/upload/images';

type UploadedAssetClient = {
  uploadedAsset: Pick<typeof db.uploadedAsset, 'updateMany'>;
};

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
  client?: UploadedAssetClient;
  path: string;
  attachedType: UploadedAssetAttachmentType;
  attachedId: string;
}) {
  const client = input.client ?? db;
  const result = await client.uploadedAsset.updateMany({
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

  if (result.count !== 1) {
    throw new Error(
      `Expected to attach exactly one staged uploaded asset for path "${input.path}", updated ${result.count}.`,
    );
  }
}

export function resolveUploadedAssetAbsolutePath(publicPath: string): string {
  const configuredDir = process.env.UPLOAD_DIR || DEFAULT_UPLOAD_DIR;
  const baseUploadDir = path.isAbsolute(configuredDir)
    ? configuredDir
    : path.resolve(process.cwd(), configuredDir);
  const publicBase = (process.env.UPLOAD_PUBLIC_PATH || DEFAULT_UPLOAD_PUBLIC_PATH).replace(/\/+$/, '');
  const normalizedPublicPath = String(publicPath || '').trim();
  if (!normalizedPublicPath.startsWith(`${publicBase}/`)) {
    throw new Error(`Uploaded asset path "${normalizedPublicPath}" is outside of upload public base "${publicBase}".`);
  }
  const relativePath = normalizedPublicPath.slice(publicBase.length + 1);
  if (!relativePath || relativePath.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error(`Uploaded asset path "${normalizedPublicPath}" is invalid.`);
  }
  return path.join(baseUploadDir, relativePath);
}

export async function stageUploadedAsset(input: {
  file: File;
  category: UploadedAssetCategory;
  createdBy: string;
}) {
  const { stagedTtlHours } = await getUploadedAssetCleanupSettings();
  const savedFile = isGenericUploadedAssetCategory(input.category)
    ? await saveUploadedFile(input.file, {
        subDir: uploadedAssetSubDirForCategory(input.category),
      })
    : await saveUploadedImage(input.file, {
        subDir: uploadedAssetSubDirForCategory(input.category),
      });

  try {
    await registerUploadedAsset({
      path: savedFile.path,
      name: savedFile.name,
      category: input.category,
      mimeType: savedFile.mimeType,
      sizeBytes: savedFile.sizeBytes,
      createdBy: input.createdBy,
      expiresAt: addHours(new Date(), stagedTtlHours),
    });
    return savedFile;
  } catch (error) {
    await rm(resolveUploadedAssetAbsolutePath(savedFile.path), { force: true }).catch(() => undefined);
    throw error;
  }
}

function isGenericUploadedAssetCategory(category: UploadedAssetCategory): boolean {
  return category === UploadedAssetCategory.AGENT_FILE;
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
    case UploadedAssetCategory.AGENT_FILE:
      return 'agents/files';
  }

  const exhaustiveCheck: never = category;
  throw new Error(`Unsupported uploaded asset category: ${exhaustiveCheck}`);
}
