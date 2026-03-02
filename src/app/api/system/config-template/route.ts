import { NextResponse } from 'next/server';
import { configTemplate } from '@/lib/api-catalog';
import { UserRole } from '@prisma/client';
import { withRole } from '@/lib/route-auth';

function maskValue(value: string | undefined): string | null {
  if (!value) return null;
  if (value.length <= 6) return '***';
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

export const GET = withRole(UserRole.ADMIN, async () => {
  const required = configTemplate.required.map((key) => ({
    key,
    isSet: Boolean(process.env[key]),
    masked: maskValue(process.env[key]),
  }));
  const optional = configTemplate.optional.map((key) => ({
    key,
    isSet: Boolean(process.env[key]),
    masked: maskValue(process.env[key]),
  }));

  return NextResponse.json({
    success: true,
    data: {
      required,
      optional,
      note: 'Fill values in .env or compose env vars before production use.',
    },
  });
});
