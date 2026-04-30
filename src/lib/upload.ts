import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
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

function validateUploadFile(file: File): void {
  if (!file || file.size <= 0) {
    throw new UploadValidationError('上传文件为空');
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    throw new UploadValidationError('文件过大，最大支持 10MB');
  }

  const mimeType = (file.type || '').toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new UploadValidationError('仅支持 JPG、PNG、WEBP、HEIC 图片');
  }

  const safeName = sanitizeFileName(file.name);
  const extension = path.extname(safeName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
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
    default:
      throw new UploadValidationError('文件扩展名不受支持');
  }
}

export async function saveUploadedImage(
  file: File,
  options: { subDir?: string | null } = {},
): Promise<{ path: string; name: string; mimeType: string; sizeBytes: number }> {
  validateUploadFile(file);

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const safeName = sanitizeFileName(file.name);
  const extension = path.extname(safeName).toLowerCase();
  if (!hasValidImageMagic(buffer, extension)) {
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
