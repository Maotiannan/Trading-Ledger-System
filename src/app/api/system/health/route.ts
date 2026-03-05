import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withAuth } from '@/lib/route-auth';

export const GET = withAuth(async () => {
  const startedAt = process.uptime();
  const now = new Date();
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({
      success: true,
      data: {
        status: 'ok',
        db: 'ok',
        uptimeSeconds: Math.floor(startedAt),
        serverDate: now.toISOString().slice(0, 10),
        serverTime: now.toISOString(),
        ocrConfigured: Boolean(process.env.OCR_API_KEY) && process.env.OCR_DISABLED !== 'true',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        data: {
          status: 'degraded',
          db: 'error',
          uptimeSeconds: Math.floor(startedAt),
          serverDate: now.toISOString().slice(0, 10),
          serverTime: now.toISOString(),
          ocrConfigured: Boolean(process.env.OCR_API_KEY) && process.env.OCR_DISABLED !== 'true',
          error: error instanceof Error ? error.message : 'unknown error',
        },
      },
      { status: 500 }
    );
  }
});
