import { NextResponse } from 'next/server';
import { configTemplate } from '@/lib/api-catalog';

function maskValue(value: string | undefined): string | null {
  if (!value) return null;
  if (value.length <= 6) return '***';
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

export async function GET() {
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
}
