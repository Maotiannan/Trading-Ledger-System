import { NextResponse } from 'next/server';
import { resetRateLimitStore } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const enabled = process.env.ENABLE_INIT_ROUTE === 'true';
  const token = request.headers.get('x-init-token');
  const expectedToken = process.env.INIT_ADMIN_TOKEN || 'test-init-token';

  if (!enabled || !token || token !== expectedToken) {
    return NextResponse.json(
      { success: false, error: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  resetRateLimitStore();

  return NextResponse.json({
    success: true,
    data: { reset: true },
  });
}
