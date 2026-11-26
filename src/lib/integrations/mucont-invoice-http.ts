import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { MucontInvoiceError } from './mucont-invoice-contract';
import { logger } from '@/lib/logger';
import { isApiError } from '@/lib/api-error';

export function authenticateInvoiceDelivery(request: Request) {
  const expected = process.env.MUCONT_INVOICE_RECEIVE_TOKEN?.trim();
  if (!expected || expected.length < 32) throw new MucontInvoiceError(503, 'INTEGRATION_DISABLED', 'Invoice receiving is not configured.');
  const candidate = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '')?.[1] || '';
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!candidate || !timingSafeEqual(digest(candidate), digest(expected))) {
    throw new MucontInvoiceError(401, 'AUTH_INVALID', 'A dedicated service credential is required.');
  }
}

export { invoiceSourceFetch } from './mucont-invoice-upstream';

export function invoiceErrorResponse(error: unknown) {
  const known = error instanceof MucontInvoiceError || isApiError(error);
  const status = known ? error.status : 503;
  const code = known ? error.code : 'INVOICE_SYNC_UNAVAILABLE';
  logger.warn('mucont.invoice.request.failed', { status, code, cause: error instanceof Error ? error.name : 'unknown' });
  return NextResponse.json({ error: { code, message: known ? error.message : 'Invoice synchronization is temporarily unavailable.',
    retryable: status >= 500 || status === 429 } }, { status, headers: { 'Cache-Control': 'no-store' } });
}
