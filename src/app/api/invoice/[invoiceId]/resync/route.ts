import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withRole } from '@/lib/route-auth';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import { parseJsonRequest } from '@/lib/http-body';
import { acceptInvoiceGeneration, requireWholeInvoice } from '@/lib/integrations/mucont-invoice-service';
import { invoiceErrorResponse, invoiceSourceFetch } from '@/lib/integrations/mucont-invoice-http';
import { invoiceConflict, MucontInvoiceError, parseInvoiceGeneration } from '@/lib/integrations/mucont-invoice-contract';
import { generationRequestSchema } from '@/lib/prepayments/contract';
import { acceptPrepaymentGeneration } from '@/lib/prepayments/generation';
import { prepaymentErrorResponse } from '@/lib/prepayments/http';

export async function POST(request: NextRequest, context: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await context.params;
  return withRole('ADMIN', async (req, user) => {
    try {
      const parsed = z.strictObject({ requestId: z.uuid(), expectedRevision: z.string().regex(/^[0-9a-f]{64}$/) }).safeParse(await parseJsonRequest(req));
      if (!parsed.success) throw new MucontInvoiceError(422, 'INVALID_RESYNC_INTENT', 'A request ID and invoice revision are required.');
      const intent = parsed.data;
      const invoice = await requireWholeInvoice(user, invoiceId, true);
      if (!invoice.mucontSource) throw new MucontInvoiceError(409, 'NOT_SOURCE_INVOICE', 'This invoice has no source generation.');
      const previous = await db.mucontInvoiceResync.findUnique({ where: { requestId: intent.requestId } });
      if (previous) {
        if (previous.actorId !== user.id || previous.invoiceBatchId !== invoice.mucontSource.invoiceBatchId || previous.expectedRevision !== intent.expectedRevision) invoiceConflict('Request ID was already used.');
        return createApiSuccessResponse({ data: previous.result }, req);
      }
      const response = await invoiceSourceFetch(`/integrations/muledger/invoices/${encodeURIComponent(invoice.mucontSource.invoiceBatchId)}/latest-generated`);
      const raw = await response.json();
      if (raw?.schemaVersion === 2) {
        const generation = generationRequestSchema.parse(raw);
        if (generation.snapshot.invoiceBatchId !== invoice.mucontSource.invoiceBatchId) invoiceConflict('Source identity changed.');
        return createApiSuccessResponse({ data: await acceptPrepaymentGeneration(generation, { ...intent, invoiceId, user }) }, req);
      }
      const snapshot = parseInvoiceGeneration(raw);
      if (snapshot.invoiceBatchId !== invoice.mucontSource.invoiceBatchId) invoiceConflict('Source returned a different invoice.');
      return createApiSuccessResponse({ data: await acceptInvoiceGeneration(snapshot, { ...intent, invoiceId, user }) }, req);
    } catch (error) { return prepaymentErrorResponse(error); }
  })(request);
}
