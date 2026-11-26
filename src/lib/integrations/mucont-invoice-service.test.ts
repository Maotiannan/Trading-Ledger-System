/** @jest-environment node */
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { editSourceInvoiceOrder, invoiceRevision } from './mucont-invoice-service';
import type { CurrentUser } from '@/lib/request-auth';

jest.mock('@/lib/db', () => ({ db: {
  mucontInvoiceGroup: { findUnique: jest.fn() },
  invoice: { findFirst: jest.fn(), update: jest.fn() },
  order: { count: jest.fn(), findUniqueOrThrow: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  orderAlias: { findFirst: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
  $queryRaw: jest.fn(),
} }));
jest.mock('@/lib/transaction', () => ({ runFinancialTransaction: jest.fn((callback) => callback(db)) }));
jest.mock('@/lib/order-balance-lock', () => ({ lockOrderBalances: jest.fn(), lockOrderSnapshots: jest.fn() }));
jest.mock('@/lib/order-balance-service', () => ({ updateOrderBalance: jest.fn() }));
jest.mock('@/lib/audit', () => ({ recordAuditEventInTransaction: jest.fn() }));
jest.mock('@/lib/user-hierarchy', () => ({ getHierarchyScope: jest.fn(async () => ({ ownerVisibleIds: new Set(['admin']) })) }));

const user = { id: 'admin', role: 'ADMIN', level: 1 } as CurrentUser;
const order = { id: 'order', invoiceId: 'invoice', orderNo: 'CURRENT-1B', amount: new Prisma.Decimal(100), customerId: 'customer', createdBy: 'admin' };
const invoice = { id: 'invoice', invNo: 'INV-1', createdBy: 'admin', orders: [order], mucontSource: { invoiceBatchId: 'batch', publicationSequence: 2, generationId: 'generation-2' } };
const link = (displayOrderNo: string) => ({ invoiceBatchId: 'batch', source: { invoiceId: 'invoice' }, orderRefs: [{ sourceOrderNo: 'ORDER-1', displayOrderNo }] });

beforeEach(() => {
  jest.resetAllMocks();
  // resetAllMocks also resets the transaction and hierarchy implementations.
  const { runFinancialTransaction } = jest.requireMock('@/lib/transaction');
  runFinancialTransaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(db));
  jest.requireMock('@/lib/user-hierarchy').getHierarchyScope.mockResolvedValue({ ownerVisibleIds: new Set(['admin']) });
  (db.invoice.findFirst as jest.Mock).mockResolvedValueOnce(invoice).mockResolvedValue(null);
  (db.order.count as jest.Mock).mockResolvedValue(1);
  (db.order.findUniqueOrThrow as jest.Mock).mockResolvedValue(order);
  (db.order.update as jest.Mock).mockResolvedValue({ ...order, orderNo: 'LOCAL-1' });
});

it('reads current group references after the source lock instead of reviving pre-lock aliases', async () => {
  (db.mucontInvoiceGroup.findUnique as jest.Mock).mockResolvedValueOnce(link('OLD-1B')).mockResolvedValue(link('CURRENT-1B'));
  await editSourceInvoiceOrder(user, { orderId: order.id, orderNo: 'LOCAL-1' });
  expect(db.orderAlias.createMany).toHaveBeenCalledWith({ data: [
    { orderId: order.id, aliasNo: 'local-1' }, { orderId: order.id, aliasNo: 'current-1b' },
  ] });
  expect(db.mucontInvoiceGroup.findUnique).toHaveBeenCalledTimes(2);
});

it('refuses a changed source identity rather than editing a different invoice', async () => {
  (db.mucontInvoiceGroup.findUnique as jest.Mock).mockResolvedValueOnce(link('OLD-1B')).mockResolvedValue(null);
  await expect(editSourceInvoiceOrder(user, { orderId: order.id, amount: 200 })).rejects.toMatchObject({ status: 409 });
  expect(db.order.update).not.toHaveBeenCalled();
});

it('financial revision ignores metadata dates and received-balance cache changes', () => {
  const metadataOnly = { ...invoice, orders: [{ ...order, orderBalance: 50 }],
    mucontSource: { ...invoice.mucontSource, metadataVersion: 99 } };
  expect(invoiceRevision(invoice)).toBe(invoiceRevision(metadataOnly));
  expect(invoiceRevision(invoice)).not.toBe(invoiceRevision({ ...invoice, orders: [{ ...order, amount: new Prisma.Decimal(200) }] }));
});

it.each(['customerMark', 'customerName', 'customerPhone', 'customerCity'])('rejects a changed read-only field %s without writing the source group', async field => {
  (db.mucontInvoiceGroup.findUnique as jest.Mock).mockResolvedValue(link('CURRENT-1B'));
  await expect(editSourceInvoiceOrder(user, { orderId: 'order', [field]: 'different' })).rejects.toThrow(/read-only/);
  expect(db.order.update).not.toHaveBeenCalled();
});
