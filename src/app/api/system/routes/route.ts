import { NextResponse } from 'next/server';
import { apiCatalog } from '@/lib/api-catalog';

export async function GET() {
  return NextResponse.json({
    success: true,
    data: {
      modules: apiCatalog,
      count: apiCatalog.length,
      generatedAt: new Date().toISOString(),
    },
  });
}
