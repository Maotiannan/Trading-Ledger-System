import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-auth';
import { requireWholeInvoice } from '@/lib/integrations/mucont-invoice-service';
import { invoiceErrorResponse, invoiceSourceFetch } from '@/lib/integrations/mucont-invoice-http';
import { MucontInvoiceError } from '@/lib/integrations/mucont-invoice-contract';

export async function GET(request: NextRequest, context: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await context.params;
  return withAuth(async (_req, user) => {
    try {
      const invoice = await requireWholeInvoice(user, invoiceId);
      if (!invoice.mucontSource) throw new MucontInvoiceError(404, 'NO_BILL_OF_LADING', 'No source bill of lading.');
      const upstream = await invoiceSourceFetch(`/integrations/muledger/invoices/${encodeURIComponent(invoice.mucontSource.invoiceBatchId)}/bill-of-lading/current/content`);
      const version = upstream.headers.get('x-mucont-file-version');
      const expectedHash = upstream.headers.get('x-content-sha256');
      if (!version || !expectedHash || !/^[0-9a-f]{64}$/.test(expectedHash) || !upstream.body) {
        await upstream.body?.cancel();
        throw new MucontInvoiceError(503, 'INVALID_SOURCE_FILE', 'Source file integrity metadata is missing.');
      }
      const hash = createHash('sha256');
      const stream = upstream.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) { hash.update(chunk); controller.enqueue(chunk); },
        flush() { if (hash.digest('hex') !== expectedHash) throw new Error('Source file checksum mismatch'); },
      }));
      return new NextResponse(stream, { headers: {
        'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
        'Content-Disposition': upstream.headers.get('content-disposition') || 'attachment; filename="bill-of-lading"',
        'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
        'X-Mucont-File-Version': version, 'X-Content-SHA256': expectedHash,
      } });
    } catch (error) { return invoiceErrorResponse(error); }
  })(request);
}
