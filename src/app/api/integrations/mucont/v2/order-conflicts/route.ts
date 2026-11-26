import { NextRequest, NextResponse } from 'next/server';
import { authenticateInvoiceDelivery, invoiceErrorResponse } from '@/lib/integrations/mucont-invoice-http';
import { listMucontOrderConflicts } from '@/lib/integrations/mucont-order-conflicts';
import { parseJsonRequest } from '@/lib/http-body';

export async function POST(request: NextRequest) {
  try {
    authenticateInvoiceDelivery(request);
    return NextResponse.json(await listMucontOrderConflicts(await parseJsonRequest(request)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) { return invoiceErrorResponse(error); }
}
