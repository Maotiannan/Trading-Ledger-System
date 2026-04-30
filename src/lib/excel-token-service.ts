import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { apiErrorCodes, createApiError } from '@/lib/api-error';
import type { CurrentUser } from '@/lib/request-auth';

const TOKEN_PREFIX = 'ml';
const MODERN_TOKEN_PATTERN = /^ml_([a-f0-9]{16})_([a-f0-9]{64})$/i;
const LEGACY_TOKEN_PREFIX_LENGTH = 11;
const LEGACY_TOKEN_SECRET_LENGTH = 43;
const LEGACY_TOKEN_ALLOWED_CHARS = /^[A-Za-z0-9_-]+$/;

export type ExcelApiTokenSummary = {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
};

type ExcelTokenRow = ExcelApiTokenSummary & {
  tokenHash?: string;
};

function hashExcelApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function secureCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function toSummary(row: ExcelTokenRow): ExcelApiTokenSummary {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastUsedAt: row.lastUsedAt,
    lastUsedIp: row.lastUsedIp,
    revokedAt: row.revokedAt,
    expiresAt: row.expiresAt,
  };
}

function createRawExcelToken(): { token: string; tokenPrefix: string } {
  const tokenPrefix = randomBytes(8).toString('hex');
  const secret = randomBytes(32).toString('hex');
  return {
    tokenPrefix,
    token: `${TOKEN_PREFIX}_${tokenPrefix}_${secret}`,
  };
}

function extractTokenPrefix(token: string): string | null {
  const normalized = token.trim();
  const modernMatch = MODERN_TOKEN_PATTERN.exec(normalized);
  if (modernMatch?.[1]) {
    return modernMatch[1];
  }

  if (!normalized.startsWith(`${TOKEN_PREFIX}_`)) {
    return null;
  }

  const remainder = normalized.slice(TOKEN_PREFIX.length + 1);
  const separatorIndex = LEGACY_TOKEN_PREFIX_LENGTH;
  if (remainder.length !== LEGACY_TOKEN_PREFIX_LENGTH + 1 + LEGACY_TOKEN_SECRET_LENGTH) {
    return null;
  }
  if (remainder[separatorIndex] !== '_') {
    return null;
  }

  const legacyPrefix = remainder.slice(0, separatorIndex);
  const legacySecret = remainder.slice(separatorIndex + 1);
  if (!LEGACY_TOKEN_ALLOWED_CHARS.test(legacyPrefix) || !LEGACY_TOKEN_ALLOWED_CHARS.test(legacySecret)) {
    return null;
  }

  return legacyPrefix;
}

function parseBearerToken(headerValue: string | null): string {
  const value = String(headerValue || '').trim();
  if (!value) {
    throw createApiError({
      code: apiErrorCodes.EXCEL_TOKEN_REQUIRED,
      status: 401,
      message: '缺少Excel API令牌',
    });
  }

  const match = /^Bearer\s+(.+)$/i.exec(value);
  if (!match?.[1]) {
    throw createApiError({
      code: apiErrorCodes.EXCEL_TOKEN_INVALID,
      status: 401,
      message: 'Excel API令牌无效',
    });
  }
  return match[1].trim();
}

export function getExcelApiTokenIp(request: NextRequest): string | null {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0]?.trim() || null;
  return request.headers.get('x-real-ip') || request.headers.get('cf-connecting-ip');
}

export async function listExcelApiTokens(currentUser: CurrentUser): Promise<ExcelApiTokenSummary[]> {
  const rows = await db.excelApiToken.findMany({
    where: { userId: currentUser.id },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      createdAt: true,
      updatedAt: true,
      lastUsedAt: true,
      lastUsedIp: true,
      revokedAt: true,
      expiresAt: true,
    },
    orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
  });
  return rows.map(toSummary);
}

export async function generateExcelApiToken(
  currentUser: CurrentUser,
  name = 'Excel ML',
): Promise<{ token: string; tokenInfo: ExcelApiTokenSummary }> {
  const now = new Date();
  const { token, tokenPrefix } = createRawExcelToken();
  const tokenHash = hashExcelApiToken(token);
  const cleanName = String(name || '').trim() || 'Excel ML';

  await db.excelApiToken.updateMany({
    where: { userId: currentUser.id, revokedAt: null },
    data: { revokedAt: now },
  });

  const row = await db.excelApiToken.create({
    data: {
      userId: currentUser.id,
      name: cleanName,
      tokenPrefix,
      tokenHash,
    },
  });

  return {
    token,
    tokenInfo: toSummary(row),
  };
}

export async function revokeExcelApiToken(currentUser: CurrentUser, tokenId: string): Promise<{ message: string }> {
  const cleanTokenId = String(tokenId || '').trim();
  if (!cleanTokenId) {
    throw createApiError({
      code: apiErrorCodes.EXCEL_TOKEN_NOT_FOUND,
      status: 404,
      message: 'Excel API令牌不存在',
    });
  }

  const result = await db.excelApiToken.updateMany({
    where: { id: cleanTokenId, userId: currentUser.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (result.count === 0) {
    throw createApiError({
      code: apiErrorCodes.EXCEL_TOKEN_NOT_FOUND,
      status: 404,
      message: 'Excel API令牌不存在',
    });
  }

  return { message: 'Excel API令牌已撤销' };
}

export async function verifyExcelApiTokenFromHeader(
  headerValue: string | null,
  ipAddress: string | null,
): Promise<{ user: CurrentUser; tokenId: string }> {
  const rawToken = parseBearerToken(headerValue);
  const tokenPrefix = extractTokenPrefix(rawToken);
  if (!tokenPrefix) {
    throw createApiError({
      code: apiErrorCodes.EXCEL_TOKEN_INVALID,
      status: 401,
      message: 'Excel API令牌无效',
    });
  }

  const row = await db.excelApiToken.findUnique({
    where: { tokenPrefix },
    select: {
      id: true,
      tokenHash: true,
      revokedAt: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          level: true,
          parentId: true,
          createdById: true,
        },
      },
    },
  });

  if (!row || !secureCompare(hashExcelApiToken(rawToken), row.tokenHash)) {
    throw createApiError({
      code: apiErrorCodes.EXCEL_TOKEN_INVALID,
      status: 401,
      message: 'Excel API令牌无效',
    });
  }

  if (row.revokedAt) {
    throw createApiError({
      code: apiErrorCodes.EXCEL_TOKEN_REVOKED,
      status: 401,
      message: 'Excel API令牌已撤销',
    });
  }

  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    throw createApiError({
      code: apiErrorCodes.EXCEL_TOKEN_EXPIRED,
      status: 401,
      message: 'Excel API令牌已过期',
    });
  }

  await db.excelApiToken.update({
    where: { id: row.id },
    data: { lastUsedAt: new Date(), lastUsedIp: ipAddress },
  });

  return { user: row.user, tokenId: row.id };
}
