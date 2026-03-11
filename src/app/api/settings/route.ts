import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-auth';
import { createApiError } from '@/lib/api-error';
import { toApiErrorResponse } from '@/lib/api-error-response';
import {
  listSettings,
  listSystemSettingsAuditLogs,
  purgeBranchBusinessData,
  purgeBusinessData,
  testSettingsOcr,
  updateSystemSettings,
} from '@/lib/settings-service';

export const GET = withAuth(async (_request, currentUser) => {
  try {
    const view = _request.nextUrl.searchParams.get('view');
    if (view === 'audit') {
      const cursor = _request.nextUrl.searchParams.get('cursor');
      const limitRaw = _request.nextUrl.searchParams.get('limit');
      const limit = limitRaw ? Number(limitRaw) : undefined;
      const data = await listSystemSettingsAuditLogs(currentUser, {
        cursor,
        limit,
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
    });
  }
});

export const POST = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const body = await request.json().catch(() => ({}));
    const action = typeof body?.action === 'string' ? body.action : '';

    if (action === 'test-ocr') {
      const result = await testSettingsOcr(currentUser);
      return NextResponse.json({
        success: true,
        message: result.message,
        detail: result.detail,
      });
    }

    if (action === 'purge-business-data') {
      const result = await purgeBusinessData(currentUser);
      return NextResponse.json({ success: true, message: result.message });
    }

    if (action === 'purge-branch-data') {
      const result = await purgeBranchBusinessData(currentUser, body ?? {});
      return NextResponse.json({ success: true, message: result.message, data: result.data });
    }

    if (action === 'update-config') {
      const result = await updateSystemSettings(currentUser, body?.settings);
      return NextResponse.json({ success: true, message: result.message });
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
    });
  }
});
