import { NextRequest } from 'next/server';

export type ParsedActionRequest = {
  action: string;
  data: Record<string, unknown>;
  file?: File;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function parseActionRequest(request: NextRequest): Promise<ParsedActionRequest> {
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const body = (await request.json()) as unknown;
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
    const body = (await request.json()) as unknown;
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
