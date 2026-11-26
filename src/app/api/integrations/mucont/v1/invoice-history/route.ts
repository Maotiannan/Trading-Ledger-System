import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withRole } from '@/lib/route-auth';
import { parseJsonRequest } from '@/lib/http-body';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import { invoiceErrorResponse, invoiceSourceFetch } from '@/lib/integrations/mucont-invoice-http';
import { acceptInvoiceGeneration, previewInvoiceGeneration } from '@/lib/integrations/mucont-invoice-service';
import { invoiceConflict, MucontInvoiceError, parseInvoiceGeneration } from '@/lib/integrations/mucont-invoice-contract';
import { parsePrepaymentGeneration, previewPrepaymentGeneration, acceptPrepaymentGeneration } from '@/lib/prepayments/generation';
import { PrepaymentError } from '@/lib/prepayments/contract';
import { prepaymentUiErrorResponse } from '@/lib/prepayments/http';

function parseSource(input: unknown) {
  const v2 = input && typeof input === 'object' && 'schemaVersion' in input && input.schemaVersion === 2;
  return v2 ? { raw: input, snapshot: parsePrepaymentGeneration(input).legacy, v2: true }
    : { raw: input, snapshot: parseInvoiceGeneration(input), v2: false };
}

export const POST = withRole('ADMIN', async (request: NextRequest, user) => {
  try {
    const parsed = z.discriminatedUnion('action', [
      z.strictObject({ action: z.literal('preview'), after: z.string().max(4096).optional(), limit: z.number().int().min(1).max(100).default(20) }),
      z.strictObject({ action: z.literal('apply'), invoiceBatchId: z.string().min(1).max(128), payloadHash: z.string().regex(/^[0-9a-f]{64}$/) }),
    ]).safeParse(await parseJsonRequest(request));
    if (!parsed.success) throw new MucontInvoiceError(422, 'INVALID_HISTORY_ACTION', 'Invalid history preview/apply request.');
    const body = parsed.data;
    if (body.action === 'apply') {
      const response = await invoiceSourceFetch(`/integrations/muledger/invoices/${encodeURIComponent(body.invoiceBatchId)}/latest-generated`);
      const source = parseSource(await response.json());
      const { snapshot } = source;
      if (snapshot.invoiceBatchId !== body.invoiceBatchId) invoiceConflict('Source identity changed.');
      const preview = source.v2 ? await previewPrepaymentGeneration(user, source.raw) : await previewInvoiceGeneration(user, snapshot);
      if (preview.payloadHash !== body.payloadHash) invoiceConflict('Source generation changed since preview.');
      const result = source.v2 ? await acceptPrepaymentGeneration(source.raw, undefined, user) : await acceptInvoiceGeneration(snapshot, undefined, user);
      return createApiSuccessResponse({ data: result }, request);
    }
    const response = await invoiceSourceFetch(`/integrations/muledger/invoice-snapshot?limit=${body.limit}${body.after ? '&after=' + encodeURIComponent(body.after) : ''}`);
    const data = z.strictObject({ schemaVersion: z.literal(1), items: z.array(z.unknown()).max(100), nextCursor: z.string().nullable(), hasMore: z.boolean() }).parse(await response.json());
    const previews = [];
    for (const item of data.items) {
      const source = parseSource(item);
      const { snapshot } = source;
      try { previews.push(source.v2 ? await previewPrepaymentGeneration(user, source.raw) : await previewInvoiceGeneration(user, snapshot)); }
      catch (error) {
        if ((error instanceof MucontInvoiceError || error instanceof PrepaymentError) && error.status === 403) continue;
        if (!(error instanceof MucontInvoiceError || error instanceof PrepaymentError) || error.status !== 409) throw error;
        previews.push({ invoiceBatchId: snapshot.invoiceBatchId, generationId: snapshot.generationId, invoiceNo: snapshot.invoiceNo,
          maxOrderDisplayLength: Math.max(...snapshot.customers.map((group) => group.orderRefs.map((ref) => ref.displayOrderNo).join('/').length)),
          result: 'CONFLICT', message: error.message });
      }
    }
    return createApiSuccessResponse({ data: { items: previews, nextCursor: data.nextCursor, hasMore: data.hasMore } }, request);
  } catch (error) { return prepaymentUiErrorResponse(error); }
});
