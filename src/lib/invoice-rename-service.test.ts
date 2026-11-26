/** @jest-environment node */
import { Prisma } from '@prisma/client';
import { renameInvoiceRecord } from './invoice-rename-service';
import { requireWholeInvoice } from './integrations/mucont-invoice-service';
import { recordAuditEventInTransaction } from './audit';
import { authorizeAllocationWrite } from './prepayments/write-context';
import type { CurrentUser } from './request-auth';

jest.mock('./integrations/mucont-invoice-service', () => ({ requireWholeInvoice: jest.fn() }));
jest.mock('./audit', () => ({ recordAuditEventInTransaction: jest.fn() }));
jest.mock('./prepayments/write-context', () => ({ authorizeAllocationWrite: jest.fn() }));
jest.mock('./transaction', () => ({ runFinancialTransaction: jest.fn((fn: (tx: unknown) => unknown) => fn(mockTx)) }));
const mockTx = {
  invoice: { findFirst: jest.fn(), update: jest.fn() }, receipt: { updateMany: jest.fn() },
  receiptGeneratorSession: { updateMany: jest.fn() },
  prepaymentPlan: { findFirst: jest.fn() },
};
const user = { id: 'admin', role: 'ADMIN' } as CurrentUser;
const input = { invoiceId: 'invoice', expectedInvNo: 'OLD', invNo: 'NEW' };
beforeEach(() => {
  jest.clearAllMocks();
  (requireWholeInvoice as jest.Mock).mockResolvedValue({ id: 'invoice', invNo: 'OLD', mucontSource: null });
  mockTx.invoice.findFirst.mockResolvedValue(null);
  mockTx.invoice.update.mockResolvedValue({ id: 'invoice', invNo: 'NEW' });
  mockTx.receipt.updateMany.mockResolvedValue({ count: 2 });
  mockTx.prepaymentPlan.findFirst.mockResolvedValue(null);
});

test('renames the whole invoice with linked labels and before/after audit, not amounts or identities', async () => {
  expect(await renameInvoiceRecord(user, { ...input, invNo: ' NEW ' })).toEqual({ data: {
    id: 'invoice', invNo: 'NEW', changed: true, receiptCount: 2,
  } });
  expect(requireWholeInvoice).toHaveBeenCalledWith(user, 'invoice', true, mockTx);
  expect(mockTx.invoice.update).toHaveBeenCalledWith({ where: { id: 'invoice' }, data: { invNo: 'NEW' } });
  expect(mockTx.receipt.updateMany).toHaveBeenCalledWith({ where: { order: { invoiceId: 'invoice' } }, data: { invNo: 'NEW' } });
  expect(authorizeAllocationWrite).toHaveBeenCalledWith(mockTx);
  expect(mockTx.receiptGeneratorSession.updateMany).toHaveBeenCalledWith({
    where: { status: 'PENDING', receipt: { order: { invoiceId: 'invoice' } } }, data: { invNo: 'NEW' },
  });
  expect(recordAuditEventInTransaction).toHaveBeenCalledWith(mockTx, expect.objectContaining({
    action: 'INVOICE_RENAMED', targetId: 'invoice', actorId: 'admin',
    metadata: { before: { invNo: 'OLD' }, after: { invNo: 'NEW' }, receiptCount: 2, invoiceBatchId: null },
  }));
});
test.each(['USER', 'SALES'])('%s cannot rename even by calling the service directly', async role => {
  await expect(renameInvoiceRecord({ ...user, role } as CurrentUser, input)).rejects.toMatchObject({ status: 403 });
  expect(requireWholeInvoice).not.toHaveBeenCalled();
});
test.each(['', 'dePosit_Pool', 'un_associated', 'x'.repeat(192), 'INV\nNEXT'])('rejects invalid target %s', async invNo => {
  await expect(renameInvoiceRecord(user, { ...input, invNo })).rejects.toMatchObject({ status: 400 });
  expect(mockTx.invoice.update).not.toHaveBeenCalled();
});
test('rejects system pool renaming', async () => {
  (requireWholeInvoice as jest.Mock).mockResolvedValue({ id: 'invoice', invNo: 'DEPOSIT_POOL' });
  await expect(renameInvoiceRecord(user, { ...input, expectedInvNo: 'DEPOSIT_POOL' })).rejects.toMatchObject({ status: 400 });
});
test('rejects stale number and propagates full-invoice visibility denial', async () => {
  await expect(renameInvoiceRecord(user, { ...input, expectedInvNo: 'STALE' })).rejects.toMatchObject({ status: 409 });
  (requireWholeInvoice as jest.Mock).mockRejectedValue({ status: 403, code: 'PARTIAL_INVOICE_SCOPE' });
  await expect(renameInvoiceRecord(user, input)).rejects.toMatchObject({ status: 403 });
  expect(mockTx.invoice.update).not.toHaveBeenCalled();
});
test('rejects occupied invoice number and uniqueness races', async () => {
  mockTx.invoice.findFirst.mockResolvedValue({ id: 'other' });
  await expect(renameInvoiceRecord(user, input)).rejects.toMatchObject({ status: 409 });
  mockTx.invoice.findFirst.mockResolvedValue(null);
  mockTx.invoice.update.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '6' }));
  await expect(renameInvoiceRecord(user, input)).rejects.toMatchObject({ status: 409 });
  expect(mockTx.receipt.updateMany).not.toHaveBeenCalled();
});
test('no-op does not write or create duplicate audit', async () => {
  const result = await renameInvoiceRecord(user, { ...input, invNo: 'OLD' });
  expect(result.data.changed).toBe(false);
  expect(mockTx.invoice.update).not.toHaveBeenCalled();
  expect(recordAuditEventInTransaction).not.toHaveBeenCalled();
});
test('blocks source rename while a generation is reserved', async () => {
  (requireWholeInvoice as jest.Mock).mockResolvedValue({ id: 'invoice', invNo: 'OLD', mucontSource: { invoiceBatchId: 'batch' } });
  mockTx.prepaymentPlan.findFirst.mockResolvedValue({ id: 'plan' });
  await expect(renameInvoiceRecord(user, input)).rejects.toMatchObject({ status: 409 });
  expect(mockTx.invoice.update).not.toHaveBeenCalled();
});
