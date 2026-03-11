import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-auth';
import { createApiError } from '@/lib/api-error';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { resolveRequestLocale } from '@/lib/api-response-locale';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import {
  listAllSystemSettingsAuditLogs,
  listSettings,
  listSystemSettingsAuditLogs,
  purgeBranchBusinessData,
  purgeBusinessData,
  testSettingsOcr,
  updateSystemSettings,
} from '@/lib/settings-service';

function escapeCsvCell(value: unknown): string {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function buildSettingsAuditCsv(
  entries: Awaited<ReturnType<typeof listAllSystemSettingsAuditLogs>>,
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
    if (view === 'audit') {
      const format = (_request.nextUrl.searchParams.get('format') || '').trim().toLowerCase();
      const cursor = _request.nextUrl.searchParams.get('cursor');
      const limitRaw = _request.nextUrl.searchParams.get('limit');
      const actor = _request.nextUrl.searchParams.get('actor');
      const key = _request.nextUrl.searchParams.get('key');
      const dateFrom = _request.nextUrl.searchParams.get('dateFrom');
      const dateTo = _request.nextUrl.searchParams.get('dateTo');
      const limit = limitRaw ? Number(limitRaw) : undefined;
      if (format === 'csv') {
        const entries = await listAllSystemSettingsAuditLogs(currentUser, {
          actor,
          key,
          dateFrom,
          dateTo,
        });
        const locale = resolveRequestLocale(_request);
        const csv = buildSettingsAuditCsv(entries, locale);
        return new NextResponse(csv, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="settings-audit-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv"`,
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
      return NextResponse.json({ success: true, data });
    }

    const data = await listSettings(currentUser);
    return NextResponse.json({ success: true, data });
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
    const body = await request.json().catch(() => ({}));
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
