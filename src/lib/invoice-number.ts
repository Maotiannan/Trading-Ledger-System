import { Prisma } from '@prisma/client';
import { createApiError } from '@/lib/api-error';
import { SYSTEM_POOL_INVOICE_NOS } from '@/lib/payment-type-classifier';
import { authorizeAllocationWrite } from '@/lib/prepayments/write-context';
import type { DbTransactionClient } from '@/lib/transaction';

export function validateInvoiceNumber(value: unknown): string {
  const invNo = typeof value === 'string' ? value.trim() : '';
  if (!invNo || invNo.length > 191 || /[\x00-\x1f\x7f]/.test(invNo)
    || [...SYSTEM_POOL_INVOICE_NOS].some(pool => pool.toLowerCase() === invNo.toLowerCase())) {
    throw createApiError({ code: 'BAD_REQUEST', status: 400, message: 'Invalid invoice number. System pool names cannot be used.' });
  }
  return invNo;
}

// Metadata only: preserve all financial identities, allocations and signed snapshots.
// Call after financial validation/writes when used by a larger transaction.
export async function renameInvoiceNumber(tx: DbTransactionClient, invoice: { id: string; invNo: string }, invNo: string) {
  if (invoice.invNo === invNo) return { changed: false, receiptCount: 0 };
  const collision = await tx.invoice.findFirst({ where: { invNo, id: { not: invoice.id } }, select: { id: true } });
  if (collision) throw createApiError({ code: 'CONFLICT', status: 409, message: 'Invoice number is already occupied.' });
  try {
    await tx.invoice.update({ where: { id: invoice.id }, data: { invNo } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw createApiError({ code: 'CONFLICT', status: 409, message: 'Invoice number is already occupied.' });
    }
    throw error;
  }
  const receiptCount = await syncInvoiceNumberReferences(tx, invoice.id, invNo);
  return { changed: true, receiptCount };
}

export async function syncInvoiceNumberReferences(tx: DbTransactionClient, invoiceId: string, invNo: string) {
  // Do not create or adjust payment funding while changing a receipt's display label.
  authorizeAllocationWrite(tx);
  const receipts = await tx.receipt.updateMany({ where: { order: { invoiceId } }, data: { invNo } });
  await tx.receiptGeneratorSession.updateMany({
    where: { status: 'PENDING', receipt: { order: { invoiceId } } }, data: { invNo },
  });
  return receipts.count;
}
