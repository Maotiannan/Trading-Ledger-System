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

export async function saveUploadedImage(file: File): Promise<{ path: string; name: string }> {
  validateUploadFile(file);

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const safeName = sanitizeFileName(file.name);
  const extension = path.extname(safeName).toLowerCase();
  const uploadDir = path.join(process.cwd(), 'upload', 'images');
  await mkdir(uploadDir, { recursive: true });

  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${extension}`;
  const filePath = path.join(uploadDir, fileName);
  await writeFile(filePath, buffer);

  return { path: `/upload/images/${fileName}`, name: safeName };
}
