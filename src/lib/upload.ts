import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);
const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
const ALLOWED_FILE_MIME_TYPES = new Set([
  ...ALLOWED_IMAGE_MIME_TYPES,
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]);
const ALLOWED_FILE_EXTENSIONS = new Set([
  ...ALLOWED_IMAGE_EXTENSIONS,
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.txt',
]);
const DEFAULT_UPLOAD_DIR = '/app/upload/images';
const DEFAULT_UPLOAD_PUBLIC_PATH = '/upload/images';

function normalizeUploadSubDir(value?: string | null): string {
  const normalized = String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  if (!normalized) return '';
  if (normalized.split('/').some((part) => part === '..' || part === '.')) {
    throw new UploadValidationError('上传目录无效');
  }
  return normalized;
}

export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadValidationError';
  }
}

function sanitizeFileName(fileName: string): string {
  const base = path.basename(fileName).trim();
  const replaced = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return replaced || 'upload.bin';
}

function validateUploadFile(file: File, options: { allowGenericFiles?: boolean } = {}): void {
  if (!file || file.size <= 0) {
    throw new UploadValidationError('上传文件为空');
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    throw new UploadValidationError('文件过大，最大支持 10MB');
  }

  const mimeType = (file.type || '').toLowerCase();
  const allowedMimeTypes = options.allowGenericFiles ? ALLOWED_FILE_MIME_TYPES : ALLOWED_IMAGE_MIME_TYPES;
  if (!allowedMimeTypes.has(mimeType)) {
    throw new UploadValidationError(options.allowGenericFiles ? '文件类型不受支持' : '仅支持 JPG、PNG、WEBP、HEIC 图片');
  }

  const safeName = sanitizeFileName(file.name);
  const extension = path.extname(safeName).toLowerCase();
  const allowedExtensions = options.allowGenericFiles ? ALLOWED_FILE_EXTENSIONS : ALLOWED_IMAGE_EXTENSIONS;
  if (!allowedExtensions.has(extension)) {
    throw new UploadValidationError('文件扩展名不受支持');
  }
}

function hasValidImageMagic(buffer: Buffer, extension: string): boolean {
  if (extension === '.jpg' || extension === '.jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (extension === '.png') {
    const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(pngSig);
  }

  if (extension === '.webp') {
    const riff = buffer.subarray(0, 4).toString('ascii');
    const webp = buffer.subarray(8, 12).toString('ascii');
    return buffer.length >= 12 && riff === 'RIFF' && webp === 'WEBP';
  }

  if (extension === '.heic' || extension === '.heif') {
    const boxType = buffer.subarray(4, 8).toString('ascii');
    const brand = buffer.subarray(8, 12).toString('ascii');
    return boxType === 'ftyp' && ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand);
  }

  return false;
}

function authoritativeMimeTypeForExtension(extension: string): string {
  switch (extension) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.heic':
      return 'image/heic';
    case '.heif':
      return 'image/heif';
    case '.pdf':
      return 'application/pdf';
    case '.doc':
      return 'application/msword';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.xls':
      return 'application/vnd.ms-excel';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.txt':
      return 'text/plain';
    default:
      throw new UploadValidationError('文件扩展名不受支持');
  }
}

function validateGenericFileMagic(buffer: Buffer, extension: string): boolean {
  if (ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
    return hasValidImageMagic(buffer, extension);
  }

  if (extension === '.pdf') {
    return buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  }

  if (extension === '.docx' || extension === '.xlsx') {
    return buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  }

  if (extension === '.doc' || extension === '.xls') {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  }

  if (extension === '.txt') {
    return true;
  }

  return false;
}

async function saveUploadedBlob(
  file: File,
  options: { subDir?: string | null; allowGenericFiles?: boolean } = {},
): Promise<{ path: string; name: string; mimeType: string; sizeBytes: number }> {
  validateUploadFile(file, { allowGenericFiles: options.allowGenericFiles });

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const safeName = sanitizeFileName(file.name);
  const extension = path.extname(safeName).toLowerCase();
  const hasValidMagic = options.allowGenericFiles
    ? validateGenericFileMagic(buffer, extension)
    : hasValidImageMagic(buffer, extension);
  if (!hasValidMagic) {
    throw new UploadValidationError('文件内容与扩展名不匹配');
  }
  const mimeType = authoritativeMimeTypeForExtension(extension);

  const configuredDir = process.env.UPLOAD_DIR || DEFAULT_UPLOAD_DIR;
  const baseUploadDir = path.isAbsolute(configuredDir)
    ? configuredDir
    : path.resolve(process.cwd(), configuredDir);
  const subDir = normalizeUploadSubDir(options.subDir);
  const uploadDir = subDir ? path.join(baseUploadDir, subDir) : baseUploadDir;
  await mkdir(uploadDir, { recursive: true });

  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${extension}`;
  const filePath = path.join(uploadDir, fileName);
  await writeFile(filePath, buffer);

  const publicBase = process.env.UPLOAD_PUBLIC_PATH || DEFAULT_UPLOAD_PUBLIC_PATH;
  const publicPath = subDir
    ? `${publicBase.replace(/\/$/, '')}/${subDir}/${fileName}`
    : `${publicBase.replace(/\/$/, '')}/${fileName}`;
  return { path: publicPath, name: safeName, mimeType, sizeBytes: buffer.byteLength };
}

export async function saveUploadedImage(
  file: File,
  options: { subDir?: string | null } = {},
): Promise<{ path: string; name: string; mimeType: string; sizeBytes: number }> {
  return saveUploadedBlob(file, options);
}

export async function saveUploadedFile(
  file: File,
  options: { subDir?: string | null } = {},
): Promise<{ path: string; name: string; mimeType: string; sizeBytes: number }> {
  return saveUploadedBlob(file, { ...options, allowGenericFiles: true });
}
