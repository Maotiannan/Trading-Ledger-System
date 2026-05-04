import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-auth';
import { createApiError } from '@/lib/api-error';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { resolveRequestLocale } from '@/lib/api-response-locale';
import { createApiSuccessResponse, localizeApiSuccessMessage } from '@/lib/api-success-response';
import { parseJsonRequest } from '@/lib/http-body';
import {
  getCurrentUserImageCompressionPreferences,
  listAllSystemSettingsAuditLogs,
  listSettings,
  listSystemSettingsAuditExportLogs,
  listSystemSettingsAuditLogs,
} from '@/lib/settings-read-service';
import {
  purgeBranchBusinessData,
  purgeBusinessData,
  testSettingsOcr,
  updateCurrentUserImageCompressionPreferences,
  updateSystemSettings,
} from '@/lib/settings-write-service';
function escapeCsvCell(value: unknown): string {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function buildSettingsAuditCsv(
  entries: Awaited<ReturnType<typeof listAllSystemSettingsAuditLogs>>['items'],
  locale: 'zh' | 'en',
): string {
  const headers = locale === 'en'
    ? ['Time', 'Actor Email', 'Actor Name', 'Updated Keys', 'Change Key', 'Before', 'After']
    : ['时间', '操作人邮箱', '操作人名称', '更新键', '变更键', '变更前', '变更后'];
  const rows = [headers.map(escapeCsvCell).join(',')];
  for (const entry of entries) {
    if (entry.changes.length === 0) {
      rows.push([
        entry.createdAt,
        entry.actor?.email || '',
        entry.actor?.name || '',
        entry.updatedKeys.join('; '),
        '',
        '',
        '',
      ].map(escapeCsvCell).join(','));
      continue;
    }
    for (const change of entry.changes) {
      rows.push([
        entry.createdAt,
        entry.actor?.email || '',
        entry.actor?.name || '',
        entry.updatedKeys.join('; '),
        change.key,
        change.before,
        change.after,
      ].map(escapeCsvCell).join(','));
    }
  }
  return `\uFEFF${rows.join('\n')}`;
}

export const GET = withAuth(async (_request, currentUser) => {
  try {
    const view = _request.nextUrl.searchParams.get('view');
    if (view === 'user-preferences') {
      const data = await getCurrentUserImageCompressionPreferences(currentUser);
      return createApiSuccessResponse({ data, message: '用户偏好已加载' }, _request);
    }

    if (view === 'audit') {
      const format = (_request.nextUrl.searchParams.get('format') || '').trim().toLowerCase();
      const cursor = _request.nextUrl.searchParams.get('cursor');
      const limitRaw = _request.nextUrl.searchParams.get('limit');
      const exportLimitRaw = _request.nextUrl.searchParams.get('exportLimit');
      const actor = _request.nextUrl.searchParams.get('actor');
      const key = _request.nextUrl.searchParams.get('key');
      const dateFrom = _request.nextUrl.searchParams.get('dateFrom');
      const dateTo = _request.nextUrl.searchParams.get('dateTo');
      const limit = limitRaw ? Number(limitRaw) : undefined;
      const exportLimit = exportLimitRaw ? Number(exportLimitRaw) : undefined;
      if (format === 'csv') {
        const result = await listAllSystemSettingsAuditLogs(currentUser, {
          actor,
          key,
          dateFrom,
          dateTo,
          exportLimit,
        });
        const locale = resolveRequestLocale(_request);
        const csv = buildSettingsAuditCsv(result.items, locale);
        const exportSummary = localizeApiSuccessMessage(
          `配置审计导出完成：已导出 ${result.items.length} 条（服务端上限 ${result.maxExportRows}${result.truncated ? '，结果已截断' : ''}）`,
          _request,
        ) || '';
        return new NextResponse(csv, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="settings-audit-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv"`,
            'X-Export-Row-Count': String(result.items.length),
            'X-Export-Limit-Applied': String(result.exportLimit),
            'X-Export-Limit-Max': String(result.maxExportRows),
            'X-Export-Truncated': result.truncated ? 'true' : 'false',
            'X-Export-Summary': encodeURIComponent(exportSummary),
          },
        });
      }
      const data = await listSystemSettingsAuditLogs(currentUser, {
        cursor,
        limit,
        actor,
        key,
        dateFrom,
        dateTo,
      });
      return createApiSuccessResponse({ data, message: `配置审计已加载，共 ${data.items.length} 条记录` }, _request);
    }

    if (view === 'audit-export-history') {
      const cursor = _request.nextUrl.searchParams.get('cursor');
      const limitRaw = _request.nextUrl.searchParams.get('limit');
      const actor = _request.nextUrl.searchParams.get('actor');
      const key = _request.nextUrl.searchParams.get('key');
      const dateFrom = _request.nextUrl.searchParams.get('dateFrom');
      const dateTo = _request.nextUrl.searchParams.get('dateTo');
      const limit = limitRaw ? Number(limitRaw) : undefined;
      const data = await listSystemSettingsAuditExportLogs(currentUser, {
        cursor,
        limit,
        actor,
        key,
        dateFrom,
        dateTo,
      });
      return createApiSuccessResponse({ data, message: `配置审计导出历史已加载，共 ${data.items.length} 条记录` }, _request);
    }

    const data = await listSettings(currentUser);
    return createApiSuccessResponse({ data, message: '设置已加载' }, _request);
  } catch (error) {
    console.error('Settings GET error:', error);
    return toApiErrorResponse(error, {
      code: 'INTERNAL_ERROR',
      status: 500,
      message: '服务器错误',
    }, _request);
  }
});

export const POST = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const body = await parseJsonRequest<Record<string, unknown>>(request).catch(() => ({} as Record<string, unknown>));
    const action = typeof body?.action === 'string' ? body.action : '';

    if (action === 'test-ocr') {
      const result = await testSettingsOcr(currentUser);
      return createApiSuccessResponse({
        message: result.message,
        detail: result.detail,
      }, request);
    }

    if (action === 'purge-business-data') {
      const result = await purgeBusinessData(currentUser);
      return createApiSuccessResponse({ message: result.message }, request);
    }

    if (action === 'purge-branch-data') {
      const result = await purgeBranchBusinessData(currentUser, body ?? {});
      return createApiSuccessResponse({ message: result.message, data: result.data }, request);
    }

    if (action === 'update-config') {
      const result = await updateSystemSettings(currentUser, body?.settings);
      return createApiSuccessResponse({ message: result.message }, request);
    }

    if (action === 'update-user-preferences') {
      const result = await updateCurrentUserImageCompressionPreferences(currentUser, body?.preferences);
      return createApiSuccessResponse({
        message: result.message,
        data: result.preferences,
      }, request);
    }

    throw createApiError({
      code: 'INVALID_ACTION',
      status: 400,
      message: '未知操作',
      detail: { action },
    });
  } catch (error) {
    console.error('Settings POST error:', error);
    return toApiErrorResponse(error, {
      code: 'INTERNAL_ERROR',
      status: 500,
      message: '服务器错误',
    }, request);
  }
});
