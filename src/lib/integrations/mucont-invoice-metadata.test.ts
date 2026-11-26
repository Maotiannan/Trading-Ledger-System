/** @jest-environment node */
import { db } from '@/lib/db';
import { invoiceSourceFetch } from './mucont-invoice-upstream';
import { readInvoiceSourceMetadata, prepareNotificationInvoiceDates } from './mucont-invoice-metadata';
jest.mock('@/lib/integrations/mucont-invoice-upstream', () => ({ invoiceSourceFetch: jest.fn() }));
jest.mock('@/lib/db', () => ({ db: {
  mucontInvoiceSource: { findMany: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
  invoice: { update: jest.fn() }, $transaction: jest.fn(), $queryRaw: jest.fn(),
} }));
const metadata = { invoiceBatchId: 'batch', availability: 'available', metadataVersion: 2, sourceUpdatedAt: '2026-11-11T00:00:00Z',
  departureDate: '2026-10-01', estimatedArrivalDate: null, releaseDate: '2026-11-01', creditInsurance: null, billOfLading: null };
const source = { invoiceId: 'invoice', invoiceBatchId: 'batch', metadata, metadataVersion: 2, metadataAvailability: 'available', metadataReadAt: new Date() };
beforeEach(() => {
  jest.clearAllMocks();
  (db.mucontInvoiceSource.findMany as jest.Mock).mockResolvedValue([source]);
  (db.mucontInvoiceSource.findUniqueOrThrow as jest.Mock).mockResolvedValue(source);
  (db.mucontInvoiceSource.update as jest.Mock).mockResolvedValue(source);
  (db.$transaction as jest.Mock).mockImplementation((callback) => callback(db));
  (invoiceSourceFetch as jest.Mock).mockResolvedValue({ json: async () => ({ schemaVersion: 1, items: [metadata] }) });
});
it('reads in one batch, refreshes only date/cache fields and returns current metadata', async () => {
  const result = await readInvoiceSourceMetadata(['invoice', 'invoice']);
  expect(invoiceSourceFetch).toHaveBeenCalledTimes(1);
  expect(result.get('invoice')?.stale).toBe(false);
  expect(db.invoice.update).toHaveBeenCalledWith({ where: { id: 'invoice' }, data: {
    shipDate: new Date('2026-10-01'), releaseDate: new Date('2026-11-01'), estimatedArrivalDate: null,
  } });
});
it('retains successful dates on transport errors and defers notification preparation', async () => {
  (invoiceSourceFetch as jest.Mock).mockRejectedValue(new Error('offline'));
  const result = await readInvoiceSourceMetadata(['invoice']);
  expect(result.get('invoice')).toMatchObject({ stale: true, metadata });
  expect(db.invoice.update).not.toHaveBeenCalled();
  await expect(prepareNotificationInvoiceDates({ notificationIds: ['notification'] })).rejects.toMatchObject({ status: 503 });
});
it('does not clear dates on deleted source or overwrite newer cached metadata', async () => {
  (invoiceSourceFetch as jest.Mock).mockResolvedValue({ json: async () => ({ schemaVersion: 1, items: [{ invoiceBatchId: 'batch', availability: 'deleted' }] }) });
  expect((await readInvoiceSourceMetadata(['invoice'])).get('invoice')).toMatchObject({ stale: true, metadata, availability: 'deleted' });
  expect(db.invoice.update).not.toHaveBeenCalled();
  (invoiceSourceFetch as jest.Mock).mockResolvedValue({ json: async () => ({ schemaVersion: 1, items: [{ ...metadata, metadataVersion: 1, releaseDate: null }] }) });
  expect((await readInvoiceSourceMetadata(['invoice'])).get('invoice')?.metadata?.releaseDate).toBe('2026-11-01');
  expect(db.invoice.update).not.toHaveBeenCalled();
});
it('rejects incomplete source batches rather than treating missing IDs as empty dates', async () => {
  (invoiceSourceFetch as jest.Mock).mockResolvedValue({ json: async () => ({ schemaVersion: 1, items: [] }) });
  expect((await readInvoiceSourceMetadata(['invoice'])).get('invoice')?.stale).toBe(true);
  expect(db.invoice.update).not.toHaveBeenCalled();
});
