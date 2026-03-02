import { NextResponse } from 'next/server';
import { apiCatalog } from '@/lib/api-catalog';
import { UserRole } from '@prisma/client';
import { withRole } from '@/lib/route-auth';

export const GET = withRole(UserRole.ADMIN, async () => {
  return NextResponse.json({
    success: true,
    data: {
      modules: apiCatalog,
      count: apiCatalog.length,
      generatedAt: new Date().toISOString(),
    },
  });
});
