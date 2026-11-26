import { validateGroupChanges, cancelRemovedGroups } from './group-cancellation';
import { financialHash, validateSnapshot } from './contract';
import { Prisma } from '@prisma/client';
import { updateOrderBalance } from '@/lib/order-balance-service';
jest.mock('@/lib/order-balance-service', () => ({ updateOrderBalance: jest.fn().mockResolvedValue({ computed: 0 }) }));
jest.mock('@/lib/audit', () => ({ recordAuditEventInTransaction: jest.fn() }));
jest.mock('./notifications', () => ({ refreshPendingPaymentNotifications: jest.fn() }));
const changes = { version: 1 as const, expectedPublicationSequence: 5, removedBillingGroupIds: ['removed'], cancelInvoice: true };
const snapshot = { invoiceBatchId: 'batch', invoiceNo: 'INV', currency: 'USD' as const, invoiceTotal: '0.00', customers: [], groupChanges: changes };
const group = { billingGroupId: 'removed', orderId: 'order', customerId: 'customer', order: { canceledAt: null } };
function tx() { return { mucontInvoiceSource: { findUnique: jest.fn().mockResolvedValue({ publicationSequence: 5, groups: [group] }) },
  balanceTransfer: { count: jest.fn().mockResolvedValue(0) } }; }
it('requires explicit exact versioned declarations, not silent loss of a customer', async () => {
  const client = tx();
  expect(await validateGroupChanges(client as never, snapshot)).toEqual([group]);
  await expect(validateGroupChanges(client as never, { ...snapshot, groupChanges: undefined })).rejects.toMatchObject({ code: 'INVOICE_REMOVAL_REQUIRED' });
  await expect(validateGroupChanges(client as never, { ...snapshot, groupChanges: { ...changes, expectedPublicationSequence: 4 } })).rejects.toMatchObject({ code: 'INVOICE_REMOVAL_VERSION_CONFLICT' });
  await expect(validateGroupChanges(client as never, { ...snapshot, groupChanges: { ...changes, removedBillingGroupIds: ['other'] } })).rejects.toMatchObject({ code: 'INVOICE_REMOVAL_GROUP_CONFLICT' });
});
it('allows restoration while excluding already canceled groups from implicit removal', async () => {
  const client = tx();
  client.mucontInvoiceSource.findUnique.mockResolvedValue({ publicationSequence: 5, groups: [{ ...group, order: { canceledAt: new Date() } }] });
  expect(await validateGroupChanges(client as never, { ...snapshot, groupChanges: undefined })).toEqual([]);
});
it('binds removal version to frozen hashes and rejects unmarked empty invoices', () => {
  expect(financialHash(snapshot)).not.toBe(financialHash({ ...snapshot, groupChanges: { ...changes, expectedPublicationSequence: 6 } }));
  expect(() => validateSnapshot({ ...snapshot, groupChanges: undefined })).toThrow('Empty invoices');
});
it('converts a real direct receipt into the existing funding model without moving or deleting it', async () => {
  const receipt = { id: 'receipt', receiptNo: 'R-1', funding: null, status: 'RECEIVED', usd: new Prisma.Decimal(1500),
    createdAt: new Date('2026-06-02'), createdBy: 'admin', generatedByBalanceTransfer: null };
  const client = { mucontInvoiceGroup: { findMany: jest.fn().mockResolvedValue([{ ...group, order: { ...group.order,
    id: 'order', amount: new Prisma.Decimal(8000), orderBalance: new Prisma.Decimal(6500), receipts: [receipt] } }]) },
    prepaymentAllocation: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    prepaymentSource: { findUnique: jest.fn().mockResolvedValue({ id: 'source' }) },
    prepaymentPlan: { findFirst: jest.fn().mockResolvedValue(null) },
    receiptFunding: { create: jest.fn().mockResolvedValue({ id: 'funding' }) }, prepaymentCredit: { create: jest.fn() },
    orderAlias: { deleteMany: jest.fn() }, order: { update: jest.fn() }, receipt: { update: jest.fn(), delete: jest.fn(), create: jest.fn() } };
  await cancelRemovedGroups(client as never, snapshot, 'admin');
  expect(client.prepaymentCredit.create).toHaveBeenCalledWith({ data: expect.objectContaining({ customerId: 'customer', sourceId: 'source', amount: receipt.usd }) });
  expect(client.order.update).toHaveBeenCalledWith({ where: { id: 'order' }, data: expect.objectContaining({ canceledAt: expect.any(Date), paymentAllocationMode: true }) });
  expect(client.receipt.update).not.toHaveBeenCalled(); expect(client.receipt.delete).not.toHaveBeenCalled(); expect(client.receipt.create).not.toHaveBeenCalled();
  expect(updateOrderBalance).toHaveBeenCalled();
});
