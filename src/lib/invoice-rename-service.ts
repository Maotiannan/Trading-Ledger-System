import type { CurrentUser } from '@/lib/request-auth';
import { createApiError } from '@/lib/api-error';
import { requireWholeInvoice } from '@/lib/integrations/mucont-invoice-service';
import { renameInvoiceNumber, validateInvoiceNumber } from '@/lib/invoice-number';
import { runFinancialTransaction } from '@/lib/transaction';
import { recordAuditEventInTransaction } from '@/lib/audit';

export async function renameInvoiceRecord(user: CurrentUser, input: {
  invoiceId: unknown; expectedInvNo: unknown; invNo: unknown;
}) {
  if (user.role !== 'ADMIN') throw createApiError({ code: 'FORBIDDEN', status: 403, message: 'Administrator permission required.' });
  const invNo = validateInvoiceNumber(input.invNo);
  if (typeof input.invoiceId !== 'string' || !input.invoiceId.trim()
    || typeof input.expectedInvNo !== 'string' || !input.expectedInvNo.trim()) {
    throw createApiError({ code: 'BAD_REQUEST', status: 400, message: 'Invoice ID and current invoice number are required.' });
  }
  const invoiceId = input.invoiceId;
  return runFinancialTransaction(async tx => {
    const invoice = await requireWholeInvoice(user, invoiceId, true, tx);
    validateInvoiceNumber(invoice.invNo);
    if (invoice.invNo !== input.expectedInvNo) {
      throw createApiError({ code: 'CONFLICT', status: 409, message: 'Invoice number has changed. Refresh before editing.' });
    }
    if (invoice.mucontSource && await tx.prepaymentPlan.findFirst({
      where: { invoiceBatchId: invoice.mucontSource.invoiceBatchId, state: 'RESERVED' }, select: { id: true },
    })) {
      throw createApiError({ code: 'CONFLICT', status: 409, message: 'Complete or cancel the pending invoice generation before editing locally.' });
    }
    const result = await renameInvoiceNumber(tx, invoice, invNo);
    if (result.changed) await recordAuditEventInTransaction(tx, {
      action: 'INVOICE_RENAMED', actorId: user.id, targetType: 'INVOICE', targetId: invoice.id,
      metadata: { before: { invNo: invoice.invNo }, after: { invNo }, receiptCount: result.receiptCount,
        invoiceBatchId: invoice.mucontSource?.invoiceBatchId ?? null },
    });
    return { data: { id: invoice.id, invNo, ...result } };
  });
}
