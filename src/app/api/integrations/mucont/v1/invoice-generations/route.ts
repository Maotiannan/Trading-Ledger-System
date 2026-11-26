import { NextRequest, NextResponse } from 'next/server';
import { parseJsonRequest } from '@/lib/http-body';
import { enforceRateLimit } from '@/lib/rate-limit';
import { acceptInvoiceGeneration } from '@/lib/integrations/mucont-invoice-service';
import { authenticateInvoiceDelivery, invoiceErrorResponse } from '@/lib/integrations/mucont-invoice-http';

export async function POST(request: NextRequest) {
  try {
    authenticateInvoiceDelivery(request);
    await enforceRateLimit('excelLookup', request, { identityHint: 'mucont-invoice-generations' });
    return NextResponse.json(await acceptInvoiceGeneration(await parseJsonRequest(request)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return invoiceErrorResponse(error); }
}
