import type { NextRequest } from 'next/server';

import { isApiError } from '@/lib/api-error';
import { createApiErrorResponse, toApiErrorResponse } from '@/lib/api-error-response';

export function safeMuContractErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code?: unknown }).code || '');
    if (code.startsWith('MU_CONTRACT_')) return code;
  }
  if (isApiError(error)) return error.code;
  return 'MU_CONTRACT_SYNC_FAILED';
}

export function toMuContractApiErrorResponse(error: unknown, request?: Request | NextRequest) {
  if (isApiError(error)) return toApiErrorResponse(error, {}, request);

  const code = safeMuContractErrorCode(error);
  if (code === 'MU_CONTRACT_INITIAL_RECONCILE_REQUIRED') {
    return createApiErrorResponse({
      code: 'CONFLICT',
      status: 409,
      message: '请先完成 Full Reconcile，再启用增量同步',
    }, request);
  }
  if (code === 'MU_CONTRACT_RECONCILE_PREVIEW_NOT_FOUND') {
    return createApiErrorResponse({
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
      message: 'Full Reconcile 预览不存在',
    }, request);
  }
  if (code === 'MU_CONTRACT_RECONCILE_PREVIEW_EXPIRED') {
    return createApiErrorResponse({
      code: 'CONFLICT',
      status: 409,
      message: 'Full Reconcile 预览已过期，请重新预览',
    }, request);
  }
  if (code === 'MU_CONTRACT_RECONCILE_PREVIEW_CONSUMED') {
    return createApiErrorResponse({
      code: 'CONFLICT',
      status: 409,
      message: 'Full Reconcile 预览已执行，请重新预览',
    }, request);
  }
  if (code === 'MU_CONTRACT_RECONCILE_SOURCE_CHANGED') {
    return createApiErrorResponse({
      code: 'CONFLICT',
      status: 409,
      message: 'MU Contract 数据已变化，请重新预览后再执行',
    }, request);
  }
  if (code === 'MU_CONTRACT_LEASE_LOST') {
    return createApiErrorResponse({
      code: 'CONFLICT',
      status: 409,
      message: '另一个同步任务正在运行，请稍后重试',
    }, request);
  }
  if (code === 'MU_CONTRACT_CONFIG_INVALID') {
    return createApiErrorResponse({
      code: 'INTERNAL_ERROR',
      status: 503,
      message: 'MU Contract 同步尚未正确配置',
    }, request);
  }
  if (code === 'MU_CONTRACT_HTTP_AUTH_FAILED') {
    return createApiErrorResponse({
      code: 'INTERNAL_ERROR',
      status: 502,
      message: 'MU Contract 同步认证失败',
    }, request);
  }

  return createApiErrorResponse({
    code: 'INTERNAL_ERROR',
    status: 500,
    message: 'MU Contract 同步失败，请稍后重试',
  }, request);
}
