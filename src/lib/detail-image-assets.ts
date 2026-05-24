import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  UploadedAssetAttachmentType,
  UploadedAssetCategory,
  UploadedAssetStatus,
} from '@prisma/client';
import { db } from '@/lib/db';
import { createApiError } from '@/lib/api-error';
import { buildDetailExportViewModel, renderDetailExportJpeg, type DetailExportSource } from '@/lib/detail-export-image';
import { resolveUploadedAssetAbsolutePath } from '@/lib/uploaded-asset-service';

const DEFAULT_UPLOAD_DIR = '/app/upload/images';
const DEFAULT_UPLOAD_PUBLIC_PATH = '/upload/images';
const DETAIL_IMAGE_SUBDIR = 'details/ocr';
const DETAIL_IMAGE_MIME_TYPE = 'image/jpeg';

type DetailImageSource = DetailExportSource & {
  id: string;
  imageUrl?: string | null;
  imageName?: string | null;
  totalAmount?: number | { toString(): string } | null;
  createdBy: string;
};

export type DetailPreviewImageAsset = {
  path: string;
  name: string;
  mimeType: string;
  buffer?: Buffer;
};

function configuredUploadDir() {
  const configured = process.env.UPLOAD_DIR || DEFAULT_UPLOAD_DIR;
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

function publicUploadBase() {
  return (process.env.UPLOAD_PUBLIC_PATH || DEFAULT_UPLOAD_PUBLIC_PATH).replace(/\/+$/, '');
}

function toNumber(value: number | { toString(): string } | null | undefined) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDatePart(value: string | Date | null | undefined, fallback?: string | Date | null) {
  const source = value || fallback || new Date();
  const parsed = source instanceof Date ? source : new Date(source);
  if (Number.isNaN(parsed.getTime())) {
    const now = new Date();
    return now.toISOString().slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

function sanitizeFileSegment(value: string) {
  const normalized = value
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'unknown';
}

function normalizeExtension(value: string | null | undefined, fallback = '.jpg') {
  const ext = path.extname(String(value || '')).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return ext;
  return fallback;
}

export function buildDetailPreviewImageFileName(detail: DetailImageSource, extension = '.jpg') {
  const amount = Math.round(toNumber(detail.totalAmount));
  const date = formatDatePart(detail.date, detail.createdAt);
  const agent = sanitizeFileSegment(detail.agent?.companyName || 'Mitty Group');
  const safeExtension = extension.startsWith('.') ? extension : `.${extension}`;
  return `payment-detail_${amount}_${date}_${agent}${safeExtension}`;
}

async function pickUniqueTarget(fileName: string) {
  const uploadDir = path.join(configuredUploadDir(), DETAIL_IMAGE_SUBDIR);
  await mkdir(uploadDir, { recursive: true });

  const parsed = path.parse(fileName);
  for (let index = 0; index < 1000; index += 1) {
    const candidateName = index === 0
      ? fileName
      : `${parsed.name}-${index + 1}${parsed.ext}`;
    const absolutePath = path.join(uploadDir, candidateName);
    try {
      await stat(absolutePath);
    } catch {
      return {
        name: candidateName,
        absolutePath,
        publicPath: `${publicUploadBase()}/${DETAIL_IMAGE_SUBDIR}/${candidateName}`,
      };
    }
  }

  throw createApiError({
    code: 'CONFLICT',
    status: 409,
    message: '付款明细图片命名冲突，请稍后重试',
  });
}

function isGeneratedDetailPreviewPath(value: string | null | undefined) {
  if (!value) return false;
  return value.includes(`/${DETAIL_IMAGE_SUBDIR}/`) && path.basename(value).startsWith('payment-detail_');
}

async function pickGeneratedPreviewTarget(detail: DetailImageSource) {
  if (isGeneratedDetailPreviewPath(detail.imageUrl)) {
    const absolutePath = resolveUploadedAssetAbsolutePath(detail.imageUrl!);
    return {
      name: detail.imageName || path.basename(detail.imageUrl!),
      absolutePath,
      publicPath: detail.imageUrl!,
    };
  }

  return pickUniqueTarget(buildDetailPreviewImageFileName(detail, '.jpg'));
}

async function upsertAttachedDetailAsset(input: {
  oldPath?: string | null;
  path: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  detail: DetailImageSource;
}) {
  if (input.oldPath && input.oldPath !== input.path) {
    const moved = await db.uploadedAsset.updateMany({
      where: { path: input.oldPath },
      data: {
        path: input.path,
        name: input.name,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        category: UploadedAssetCategory.DETAIL_OCR,
        status: UploadedAssetStatus.ATTACHED,
        attachedType: UploadedAssetAttachmentType.DETAIL,
        attachedId: input.detail.id,
        expiresAt: null,
      },
    });
    if (moved.count > 0) return;
  }

  await db.uploadedAsset.upsert({
    where: { path: input.path },
    create: {
      path: input.path,
      name: input.name,
      category: UploadedAssetCategory.DETAIL_OCR,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      createdBy: input.detail.createdBy,
      status: UploadedAssetStatus.ATTACHED,
      attachedType: UploadedAssetAttachmentType.DETAIL,
      attachedId: input.detail.id,
      expiresAt: null,
    },
    update: {
      name: input.name,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      category: UploadedAssetCategory.DETAIL_OCR,
      status: UploadedAssetStatus.ATTACHED,
      attachedType: UploadedAssetAttachmentType.DETAIL,
      attachedId: input.detail.id,
      expiresAt: null,
      deletedAt: null,
    },
  });
}

async function updateDetailImageReference(detail: DetailImageSource, saved: DetailPreviewImageAsset) {
  await db.detail.update({
    where: { id: detail.id },
    data: {
      imageUrl: saved.path,
      imageName: saved.name,
    },
  });
}

async function standardizeExistingDetailImage(detail: DetailImageSource, includeBuffer: boolean): Promise<DetailPreviewImageAsset> {
  if (!detail.imageUrl) {
    throw new Error('Cannot standardize a missing detail image.');
  }

  const currentAbsolutePath = resolveUploadedAssetAbsolutePath(detail.imageUrl);
  const extension = normalizeExtension(detail.imageName || detail.imageUrl);
  const targetFileName = buildDetailPreviewImageFileName(detail, extension);
  if (
    path.basename(detail.imageUrl) === targetFileName
    && detail.imageUrl.includes(`/${DETAIL_IMAGE_SUBDIR}/`)
  ) {
    const sizeBytes = (await stat(currentAbsolutePath)).size;
    const saved = {
      path: detail.imageUrl,
      name: detail.imageName || targetFileName,
      mimeType: extension === '.png' ? 'image/png' : DETAIL_IMAGE_MIME_TYPE,
      buffer: includeBuffer ? await readFile(currentAbsolutePath) : undefined,
    };
    await upsertAttachedDetailAsset({
      path: saved.path,
      name: saved.name,
      mimeType: saved.mimeType,
      sizeBytes,
      detail,
    });
    return saved;
  }

  const target = await pickUniqueTarget(targetFileName);

  if (target.publicPath !== detail.imageUrl) {
    await rename(currentAbsolutePath, target.absolutePath);
  }

  const sizeBytes = (await stat(target.absolutePath)).size;
  const saved = {
    path: target.publicPath,
    name: target.name,
    mimeType: extension === '.png' ? 'image/png' : DETAIL_IMAGE_MIME_TYPE,
    buffer: includeBuffer ? await readFile(target.absolutePath) : undefined,
  };

  await updateDetailImageReference(detail, saved);
  await upsertAttachedDetailAsset({
    oldPath: detail.imageUrl,
    path: saved.path,
    name: saved.name,
    mimeType: saved.mimeType,
    sizeBytes,
    detail,
  });

  return saved;
}

async function generateDetailExportImage(
  detail: DetailImageSource,
  includeBuffer: boolean,
  options: { overwriteGeneratedPreview?: boolean } = {},
): Promise<DetailPreviewImageAsset> {
  const viewModel = await buildDetailExportViewModel(detail);
  const buffer = await renderDetailExportJpeg(viewModel);
  const target = options.overwriteGeneratedPreview
    ? await pickGeneratedPreviewTarget(detail)
    : await pickUniqueTarget(buildDetailPreviewImageFileName(detail, '.jpg'));
  await writeFile(target.absolutePath, buffer);

  const saved = {
    path: target.publicPath,
    name: target.name,
    mimeType: DETAIL_IMAGE_MIME_TYPE,
    buffer: includeBuffer ? buffer : undefined,
  };

  await updateDetailImageReference(detail, saved);
  await upsertAttachedDetailAsset({
    path: saved.path,
    name: saved.name,
    mimeType: saved.mimeType,
    sizeBytes: buffer.byteLength,
    detail,
  });

  return saved;
}

async function loadDetailForPreview(detailId: string): Promise<DetailImageSource> {
  const detail = await db.detail.findUnique({
    where: { id: detailId },
    include: {
      agent: true,
      creator: { select: { id: true, name: true, email: true } },
      items: {
        include: {
          receipt: {
            select: {
              id: true,
              orderNo: true,
              orderId: true,
              isDeposit: true,
              createdAt: true,
            },
          },
        },
      },
      swift: {
        select: {
          status: true,
        },
      },
    },
  });

  if (!detail) {
    throw createApiError({
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
      message: '付款明细不存在或无权访问',
      detail: { detailId },
    });
  }

  return detail;
}

export async function ensureDetailPreviewImage(
  detailId: string,
  options: { includeBuffer?: boolean } = {},
): Promise<DetailPreviewImageAsset> {
  const detail = await loadDetailForPreview(detailId);
  if (detail.imageUrl) {
    return standardizeExistingDetailImage(detail, Boolean(options.includeBuffer));
  }
  return generateDetailExportImage(detail, Boolean(options.includeBuffer));
}

export async function regenerateDetailPreviewImage(
  detailId: string,
  options: { includeBuffer?: boolean } = {},
): Promise<DetailPreviewImageAsset> {
  const detail = await loadDetailForPreview(detailId);
  return generateDetailExportImage(detail, Boolean(options.includeBuffer), { overwriteGeneratedPreview: true });
}
