'use client';

import { useCallback, useState } from 'react';
import { apiCall, getApiErrorMessage } from '@/components/workspace/shared';
import type { ExcelApiTokenSummary } from '../types';

type ExcelTokenText = (zh: string, en: string) => string;

function normalizeTokenSummary(value: unknown): ExcelApiTokenSummary | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : '';
  const tokenPrefix = typeof row.tokenPrefix === 'string' ? row.tokenPrefix : '';
  if (!id || !tokenPrefix) return null;
  return {
    id,
    name: typeof row.name === 'string' && row.name.trim() ? row.name : 'Excel ML',
    tokenPrefix,
    createdAt: typeof row.createdAt === 'string' || row.createdAt instanceof Date ? row.createdAt : '',
    updatedAt: typeof row.updatedAt === 'string' || row.updatedAt instanceof Date ? row.updatedAt : '',
    lastUsedAt: typeof row.lastUsedAt === 'string' || row.lastUsedAt instanceof Date ? row.lastUsedAt : null,
    lastUsedIp: typeof row.lastUsedIp === 'string' ? row.lastUsedIp : null,
    revokedAt: typeof row.revokedAt === 'string' || row.revokedAt instanceof Date ? row.revokedAt : null,
    expiresAt: typeof row.expiresAt === 'string' || row.expiresAt instanceof Date ? row.expiresAt : null,
  };
}

function normalizeTokenList(value: unknown): ExcelApiTokenSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeTokenSummary)
    .filter((row): row is ExcelApiTokenSummary => Boolean(row));
}

export function useExcelTokenSettings(tx: ExcelTokenText) {
  const [excelTokens, setExcelTokens] = useState<ExcelApiTokenSummary[]>([]);
  const [oneTimeExcelToken, setOneTimeExcelToken] = useState<string | null>(null);
  const [excelTokenLoading, setExcelTokenLoading] = useState(false);
  const [excelTokenSaving, setExcelTokenSaving] = useState(false);
  const [excelTokenError, setExcelTokenError] = useState<string | null>(null);
  const [excelTokenMessage, setExcelTokenMessage] = useState<string | null>(null);

  const loadExcelTokens = useCallback(async () => {
    setExcelTokenLoading(true);
    setExcelTokenError(null);
    try {
      const result = await apiCall('excel/token');
      if (result.success) {
        setExcelTokens(normalizeTokenList(result.data));
      }
    } catch (err) {
      setExcelTokenError(getApiErrorMessage(err, tx('加载Excel令牌失败', 'Failed to load Excel tokens')));
    } finally {
      setExcelTokenLoading(false);
    }
  }, [tx]);

  const generateExcelToken = useCallback(async () => {
    setExcelTokenSaving(true);
    setExcelTokenError(null);
    setExcelTokenMessage(null);
    setOneTimeExcelToken(null);
    try {
      const result = await apiCall('excel/token', {
        method: 'POST',
        body: JSON.stringify({ action: 'generate', name: 'Excel ML' }),
      });
      if (result.success) {
        const data = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
        const token = typeof data.token === 'string' ? data.token : '';
        const tokenInfo = normalizeTokenSummary(data.tokenInfo);
        setOneTimeExcelToken(token || null);
        if (tokenInfo) {
          setExcelTokens((prev) => [tokenInfo, ...prev.filter((row) => row.id !== tokenInfo.id)]);
        }
        setExcelTokenMessage(result.message || tx('Excel API令牌已生成', 'Excel API token generated'));
        await loadExcelTokens();
      }
    } catch (err) {
      setExcelTokenError(getApiErrorMessage(err, tx('生成Excel令牌失败', 'Failed to generate Excel token')));
    } finally {
      setExcelTokenSaving(false);
    }
  }, [loadExcelTokens, tx]);

  const revokeExcelToken = useCallback(async (tokenId: string) => {
    const cleanTokenId = tokenId.trim();
    if (!cleanTokenId) return;
    setExcelTokenSaving(true);
    setExcelTokenError(null);
    setExcelTokenMessage(null);
    try {
      const result = await apiCall('excel/token', {
        method: 'POST',
        body: JSON.stringify({ action: 'revoke', id: cleanTokenId }),
      });
      if (result.success) {
        setOneTimeExcelToken(null);
        setExcelTokenMessage(result.message || tx('Excel API令牌已撤销', 'Excel API token revoked'));
        await loadExcelTokens();
      }
    } catch (err) {
      setExcelTokenError(getApiErrorMessage(err, tx('撤销Excel令牌失败', 'Failed to revoke Excel token')));
    } finally {
      setExcelTokenSaving(false);
    }
  }, [loadExcelTokens, tx]);

  return {
    excelTokens,
    oneTimeExcelToken,
    excelTokenLoading,
    excelTokenSaving,
    excelTokenError,
    excelTokenMessage,
    loadExcelTokens,
    generateExcelToken,
    revokeExcelToken,
  };
}
