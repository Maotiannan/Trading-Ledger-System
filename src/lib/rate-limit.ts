import { NextRequest } from 'next/server';
import { createApiError } from '@/lib/api-error';
import type { CurrentUser } from '@/lib/request-auth';
import { getNumericSystemSetting, type EditableSystemSettingKey } from '@/lib/system-settings';

type RateLimitBucket = 'login' | 'upload' | 'deletion' | 'excelLookup';

type RateLimitBucketConfig = {
  windowKey: EditableSystemSettingKey;
  maxKey: EditableSystemSettingKey;
  fallbackWindowMs: number;
  fallbackMax: number;
  message: string;
};

const bucketConfigs: Record<RateLimitBucket, RateLimitBucketConfig> = {
  login: {
    windowKey: 'AUTH_LOGIN_RATE_LIMIT_WINDOW_MS',
    maxKey: 'AUTH_LOGIN_RATE_LIMIT_MAX',
    fallbackWindowMs: 60_000,
    fallbackMax: 20,
    message: '登录请求过于频繁，请稍后再试',
  },
  upload: {
    windowKey: 'UPLOAD_ACTION_RATE_LIMIT_WINDOW_MS',
    maxKey: 'UPLOAD_ACTION_RATE_LIMIT_MAX',
    fallbackWindowMs: 60_000,
    fallbackMax: 20,
    message: '上传请求过于频繁，请稍后再试',
  },
  deletion: {
    windowKey: 'DELETION_ACTION_RATE_LIMIT_WINDOW_MS',
    maxKey: 'DELETION_ACTION_RATE_LIMIT_MAX',
    fallbackWindowMs: 60_000,
    fallbackMax: 20,
    message: '删除相关操作过于频繁，请稍后再试',
  },
  excelLookup: {
    windowKey: 'EXCEL_LOOKUP_RATE_LIMIT_WINDOW_MS',
    maxKey: 'EXCEL_LOOKUP_RATE_LIMIT_MAX',
    fallbackWindowMs: 60_000,
    fallbackMax: 240,
    message: 'Excel查询请求过于频繁，请稍后再试',
  },
};

const rateLimitStore = new Map<string, number[]>();

function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown';
  }
  return request.headers.get('x-real-ip') || request.headers.get('cf-connecting-ip') || 'unknown';
}

function buildRateLimitKey(
  bucket: RateLimitBucket,
  request: NextRequest,
  options: { currentUser?: CurrentUser | null; identityHint?: string | null },
): string {
  const ip = getClientIp(request);
  if (options.currentUser?.id) {
    return `${bucket}:user:${options.currentUser.id}:ip:${ip}`;
  }
  const identityHint = (options.identityHint || '').trim().toLowerCase();
  if (identityHint) {
    return `${bucket}:hint:${identityHint}:ip:${ip}`;
  }
  return `${bucket}:ip:${ip}`;
}

export function resetRateLimitStore(): void {
  rateLimitStore.clear();
}

export async function enforceRateLimit(
  bucket: RateLimitBucket,
  request: NextRequest,
  options: { currentUser?: CurrentUser | null; identityHint?: string | null } = {},
): Promise<void> {
  const config = bucketConfigs[bucket];
  const [windowMs, max] = await Promise.all([
    getNumericSystemSetting(config.windowKey, config.fallbackWindowMs, { min: 1000 }),
    getNumericSystemSetting(config.maxKey, config.fallbackMax, { min: 1 }),
  ]);

  const key = buildRateLimitKey(bucket, request, options);
  const now = Date.now();
  const threshold = now - windowMs;
  const active = (rateLimitStore.get(key) || []).filter((timestamp) => timestamp > threshold);

  if (active.length >= max) {
    const retryAfterMs = Math.max(1, windowMs - (now - active[0]));
    rateLimitStore.set(key, active);
    throw createApiError({
      code: 'RATE_LIMITED',
      status: 429,
      message: config.message,
      detail: {
        bucket,
        retryAfterMs,
        max,
        windowMs,
      },
    });
  }

  active.push(now);
  rateLimitStore.set(key, active);
}
