import { NextResponse } from 'next/server';
import { runUploadedAssetMaintenance } from '@/lib/uploaded-asset-maintenance';
import { requireProductionSecret } from '@/lib/security-config';

export async function POST(request: Request) {
  const token = request.headers.get('x-maintenance-token');
  const expectedToken = requireProductionSecret('MAINTENANCE_JOB_TOKEN', process.env.MAINTENANCE_JOB_TOKEN);

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
