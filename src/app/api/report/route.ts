import { NextRequest, NextResponse } from 'next/server';
import { apiErrorCodes } from '@/lib/api-error';
import { createApiErrorResponse, toApiErrorResponse } from '@/lib/api-error-response';
import { localizeApiSuccessMessage } from '@/lib/api-success-response';
import { withAuth } from '@/lib/route-auth';
import { exportReport } from '@/lib/report-service';
import { logger } from '@/lib/logger';

export const GET = withAuth(async (request: NextRequest, currentUser) => {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format');

  if (format !== 'excel' && format !== 'pdf') {
    return createApiErrorResponse({
      code: apiErrorCodes.EXPORT_FORMAT_INVALID,
      status: 400,
      message: 'format must be excel or pdf',
      detail: { format },
    }, request);
  }

  try {
    const result = await exportReport(currentUser, format);

    return new NextResponse(result.fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Content-Disposition': `attachment; filename="${result.fileName}"`,
        'X-Success-Message': encodeURIComponent(localizeApiSuccessMessage(result.message, request) || ''),
      },
    });
  } catch (error) {
    logger.error('Report export failed', error);
    return toApiErrorResponse(error, {
      code: apiErrorCodes.REPORT_EXPORT_FAILED,
      status: 500,
      message: '报表导出失败',
    }, request);
  }
});
