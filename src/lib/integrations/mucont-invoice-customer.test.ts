/** @jest-environment node */
import { guardSourceCustomerWrites, sourceReceiptCustomer } from './mucont-invoice-customer';
import type { DbTransactionClient } from '@/lib/transaction';

function client() {
  return { mucontInvoiceGroup: { findUnique: jest.fn(), findMany: jest.fn() }, receipt: { findMany: jest.fn() } };
}
const group = { orderId: 'order', customerId: 'stable', order: {
  customerId: 'stable', customerMark: 'OLD MARK', customerName: 'OLD NAME', customerPhone: '123', customerCity: 'city',
  customer: { id: 'stable', mark: 'NEW MARK', name: 'Current Customer', orderName: 'NEW NAME', companyName: null },
} };
it('takes current MARK from the stable customer while preserving other snapshot fields', async () => {
  const mock = client(); mock.mucontInvoiceGroup.findUnique.mockResolvedValue(group);
  expect(await sourceReceiptCustomer(mock as unknown as DbTransactionClient, 'order')).toMatchObject({
    customerId: 'stable', customerMark: 'NEW MARK', customerName: 'OLD NAME', needsCustomerFix: false,
  });
  await expect(sourceReceiptCustomer(mock as unknown as DbTransactionClient, 'order', 'other')).rejects.toMatchObject({ status: 409 });
  mock.mucontInvoiceGroup.findUnique.mockResolvedValue({ ...group, order: { ...group.order, customerId: null } });
  await expect(sourceReceiptCustomer(mock as unknown as DbTransactionClient, 'order')).rejects.toMatchObject({ status: 409 });
});
it('leaves manual orders to the existing matching rules', async () => {
  const mock = client(); mock.mucontInvoiceGroup.findUnique.mockResolvedValue(null);
  expect(await sourceReceiptCustomer(mock as unknown as DbTransactionClient, 'manual')).toBeNull();
});
it.each([null, 'wrong', { set: null }])('rejects clearing/replacing order identity, including bulk writes (%j)', async (customerId) => {
  const mock = client(); mock.mucontInvoiceGroup.findMany.mockResolvedValue([group]);
  await expect(guardSourceCustomerWrites(mock as unknown as DbTransactionClient, 'order', 'updateMany', { data: { customerId } }, ['order']))
    .rejects.toMatchObject({ status: 409 });
});
it('checks receipt identity against its new target for create, edit and bulk fix', async () => {
  const mock = client(); const tx = mock as unknown as DbTransactionClient;
  mock.mucontInvoiceGroup.findMany.mockResolvedValue([group]);
  await expect(guardSourceCustomerWrites(tx, 'receipt', 'create', { data: { orderId: 'order', customerId: null } }, []))
    .rejects.toMatchObject({ status: 409 });
  mock.receipt.findMany.mockResolvedValue([{ orderId: 'order', customerId: 'stable' }]);
  await expect(guardSourceCustomerWrites(tx, 'receipt', 'updateMany', { data: { customerId: 'wrong' } }, ['receipt']))
    .rejects.toMatchObject({ status: 409 });
  await expect(guardSourceCustomerWrites(tx, 'receipt', 'update', { data: { orderId: 'order', customerId: 'stable' } }, ['receipt']))
    .resolves.toBeUndefined();
});
it('does not add identity queries to unrelated balance/status updates', async () => {
  const mock = client(); const tx = mock as unknown as DbTransactionClient;
  await guardSourceCustomerWrites(tx, 'order', 'update', { data: { orderBalance: 6000 } }, ['order']);
  await guardSourceCustomerWrites(tx, 'receipt', 'updateMany', { data: { status: 'RECEIVED' } }, ['receipt']);
  expect(mock.mucontInvoiceGroup.findMany).not.toHaveBeenCalled();
});
