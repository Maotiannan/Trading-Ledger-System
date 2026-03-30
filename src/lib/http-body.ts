import { NextRequest } from 'next/server';
import { createApiError } from '@/lib/api-error';

export type ParsedActionRequest = {
  action: string;
  data: Record<string, unknown>;
  file?: File;
};

const DEFAULT_JSON_BODY_MAX_BYTES = Number(process.env.JSON_BODY_MAX_BYTES || 256 * 1024);
const DEFAULT_UPLOAD_BODY_MAX_BYTES = Number(process.env.UPLOAD_BODY_MAX_BYTES || 10 * 1024 * 1024);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getRequestBodyLimit(request: NextRequest): number {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
    return DEFAULT_UPLOAD_BODY_MAX_BYTES;
  }
  return DEFAULT_JSON_BODY_MAX_BYTES;
}

function getDeclaredContentLength(request: NextRequest): number | null {
  const raw = request.headers.get('content-length');
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export async function assertRequestBodyWithinLimit(request: NextRequest): Promise<void> {
  const limit = getRequestBodyLimit(request);
  const declaredLength = getDeclaredContentLength(request);
  if (declaredLength !== null && declaredLength > limit) {
    throw createApiError({
      code: 'REQUEST_TOO_LARGE',
      status: 413,
      message: '请求体过大',
      detail: { limitBytes: limit, receivedBytes: declaredLength },
    });
  }
}

export async function parseJsonRequest<T = Record<string, unknown>>(request: NextRequest): Promise<T> {
  await assertRequestBodyWithinLimit(request);
  const raw = await request.text();
  const actualLength = Buffer.byteLength(raw, 'utf8');
  const limit = getRequestBodyLimit(request);
  if (actualLength > limit) {
    throw createApiError({
      code: 'REQUEST_TOO_LARGE',
      status: 413,
      message: '请求体过大',
      detail: { limitBytes: limit, receivedBytes: actualLength },
    });
  }
  if (!raw.trim()) {
    return {} as T;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: '请求体格式错误',
    });
  }
}

export async function parseActionRequest(request: NextRequest): Promise<ParsedActionRequest> {
  await assertRequestBodyWithinLimit(request);
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const body = (await parseJsonRequest(request)) as unknown;
    if (!isRecord(body)) {
      return { action: '', data: {} };
    }
    return {
      action: typeof body.action === 'string' ? body.action : '',
      data: body,
    };
  }

  if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
    const formData = await request.formData();
    return parseFormData(formData);
  }

  try {
    const body = (await parseJsonRequest(request)) as unknown;
    if (isRecord(body)) {
      return {
        action: typeof body.action === 'string' ? body.action : '',
        data: body,
      };
    }
  } catch {
    // ignore and fallback to formData
  }

  try {
    const formData = await request.formData();
    return parseFormData(formData);
  } catch {
    return { action: '', data: {} };
  }
}

function parseFormData(formData: FormData): ParsedActionRequest {
  const data: Record<string, unknown> = {};
  let file: File | undefined;

  for (const [key, value] of formData.entries()) {
    if (key === 'file' && value instanceof File) {
      file = value;
      continue;
    }
    if (typeof value === 'string') {
      data[key] = value;
    }
  }

  return {
    action: typeof data.action === 'string' ? data.action : '',
    data,
    file,
  };
}
