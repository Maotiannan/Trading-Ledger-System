import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { createApiError } from '@/lib/api-error';

const DEFAULT_UPLOAD_DIR = '/app/upload/images';
const DEFAULT_UPLOAD_PUBLIC_PATH = '/upload/images';

function sanitizePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function resolveUploadBaseDir(): string {
  const configuredDir = process.env.UPLOAD_DIR || DEFAULT_UPLOAD_DIR;
  return path.isAbsolute(configuredDir)
    ? configuredDir
    : path.resolve(process.cwd(), configuredDir);
}

function resolveUploadPublicBase(): string {
  return (process.env.UPLOAD_PUBLIC_PATH || DEFAULT_UPLOAD_PUBLIC_PATH).replace(/\/$/, '');
}

function resolveGeneratorSubDir(now = new Date()): string {
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `receipts/generated/${year}/${month}`;
}

function resolveSignatureSubDir(now = new Date()): string {
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `receipts/generated/${year}/${month}/signatures`;
}

function mimeToExtension(mime: string): string {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  throw createApiError({
    code: 'BAD_REQUEST',
    status: 400,
    message: '生成图片格式无效',
    detail: { mime },
  });
}

async function saveBuffer(params: {
  buffer: Buffer;
  mime: string;
  subDir: string;
  fileNamePrefix: string;
}) {
  const uploadDir = path.join(resolveUploadBaseDir(), params.subDir);
  await mkdir(uploadDir, { recursive: true });
  const extension = mimeToExtension(params.mime);
  const fileName = `${sanitizePart(params.fileNamePrefix)}${extension}`;
  const absolutePath = path.join(uploadDir, fileName);
  await writeFile(absolutePath, params.buffer);
  return {
    path: `${resolveUploadPublicBase()}/${params.subDir}/${fileName}`,
    name: fileName,
  };
}

export async function saveReceiptGeneratorArtifact(params: {
  kind: 'receipt' | 'receiver-signature' | 'payer-signature';
  receiptNo: string;
  buffer: Buffer;
  mime: string;
  now?: Date;
}) {
  const now = params.now || new Date();
  const subDir = params.kind === 'receipt' ? resolveGeneratorSubDir(now) : resolveSignatureSubDir(now);
  const suffix = params.kind === 'receipt'
    ? 'receipt'
    : (params.kind === 'receiver-signature' ? 'receiver-signature' : 'payer-signature');
  return saveBuffer({
    buffer: params.buffer,
    mime: params.mime,
    subDir,
    fileNamePrefix: `${params.receiptNo}-${suffix}`,
  });
}
