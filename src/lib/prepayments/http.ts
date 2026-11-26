import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { authenticateInvoiceDelivery, invoiceErrorResponse } from '@/lib/integrations/mucont-invoice-http';
import { PrepaymentError } from './contract';

export async function prepaymentEndpoint(request: Request, operation: () => Promise<unknown>) {
  try {
    authenticateInvoiceDelivery(request);
    return NextResponse.json(await operation(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return prepaymentErrorResponse(error); }
}

export function prepaymentErrorResponse(error: unknown) {
    if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ error: {
      code: 'PREPAYMENT_INVALID_PAYLOAD', message: 'Invalid payment allocation payload.', retryable: false,
    } }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
    if (error instanceof PrepaymentError) return NextResponse.json({ error: {
      code: error.code, message: error.message, retryable: error.status >= 500,
    } }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
    return invoiceErrorResponse(error);
}

export async function prepaymentUiErrorResponse(error: unknown) {
  const response = prepaymentErrorResponse(error);
  const body = await response.json();
  return NextResponse.json({ success: false, error: body.error.message, code: body.error.code },
    { status: response.status, headers: { 'Cache-Control': 'no-store' } });
}
