import { NextResponse } from 'next/server';
import { runUploadedAssetMaintenance } from '@/lib/uploaded-asset-maintenance';

export async function POST(request: Request) {
  const token = request.headers.get('x-maintenance-token');
  const expectedToken = process.env.MAINTENANCE_JOB_TOKEN || 'replace-with-a-long-random-secret';

  if (!token || token !== expectedToken) {
    return NextResponse.json(
      { success: false, error: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  const data = await runUploadedAssetMaintenance();

  return NextResponse.json({
    success: true,
    data,
  });
}
