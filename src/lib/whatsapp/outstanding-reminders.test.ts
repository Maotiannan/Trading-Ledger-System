/** @jest-environment node */
jest.mock('@/lib/db', () => ({ db: {} }));
jest.mock('./whatsapp-template-service', () => ({ listWhatsAppTemplateVersions: jest.fn() }));
import type { WhatsAppDelivery } from '@prisma/client';
import type { DbTransactionClient } from '@/lib/transaction';
import { refreshOutstandingReminder } from './outstanding-reminders';
import { defaultTemplateVersions } from './whatsapp-template-definition';

const now = new Date('2026-10-06T07:00:00Z');
const template = { ...defaultTemplateVersions().find(item => item.kind === 'outstanding60')!, active: true, status: 'APPROVED' };
const customer = { id: 'customer', name: 'Example', companyName: null, mark: 'EX', phone: '+224622491286' };
const contact = { id: 'contact', customerId: customer.id };
let tx: DbTransactionClient;
let delivery: WhatsAppDelivery;
let updateMany: jest.Mock;
let invoices: unknown[];
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(now);
  updateMany = jest.fn(async () => ({ count: 1 }));
  delivery = { id: 'delivery', type: 'OUTSTANDING_REMINDER', status: 'QUEUED', testMode: true, updatedAt: now,
    businessSnapshot: { customerId: customer.id }, templateName: template.name, languageCode: 'fr',
    parameters: [], intendedTo: customer.phone, actualTo: '+8613619767412', contactId: contact.id,
  } as unknown as WhatsAppDelivery;
  invoices = [{ id: 'invoice', invNo: 'INV-EX', releaseDate: new Date('2026-07-30T00:00:00Z'), orders: [
    { id: 'order', orderNo: 'EX-01', customerId: customer.id, customerName: customer.name, customerMark: customer.mark,
      amount: 28674, orderBalance: 38674, receipts: [{ usd: 10000, status: 'RECEIVED' }, { usd: 15000, status: 'Bank_Transfer' }, { usd: 1000, status: 'SIGNING_PENDING' }] },
  ] }];
  tx = {
    systemSetting: { upsert: jest.fn(), findUnique: jest.fn(async () => ({ value: JSON.stringify({ reminderEnabled: true, reminderTestMode: true }) })) },
    customer: { findUnique: jest.fn(async () => customer) }, invoice: { findMany: jest.fn(async () => invoices) },
    whatsAppDelivery: { findFirst: jest.fn(async () => null), updateMany, findUnique: jest.fn(async () => delivery) },
    customerWhatsAppContact: { findFirst: jest.fn(async () => contact) }, receipt: { findMany: jest.fn(async () => []) },
    deletionRequest: { findFirst: jest.fn(async () => null) },
  } as unknown as DbTransactionClient;
});
afterEach(() => jest.useRealTimers());

it('uses live balances, forces French, freezes the test number and restarts approval after change', async () => {
  await refreshOutstandingReminder(tx, delivery, [template]);
  const data = updateMany.mock.calls[0][0].data;
  expect(data.businessSnapshot.outstanding.totalOutstanding).toBe(3674);
  expect(data.parameters[1]).toBe('3,674');
  expect(data.languageCode).toBe('fr');
  expect(data.actualTo).toBe('+8613619767412');
  expect(data.status).toBe('PENDING');
  expect(data.nextSendAt).toEqual(new Date('2026-10-06T07:05:00Z'));
});
it('cancels when settled or at/below the threshold', async () => {
  invoices = [];
  expect(await refreshOutstandingReminder(tx, delivery, [template])).toBeNull();
  expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'CANCELLED', failureCode: 'REMINDER_NO_LONGER_ELIGIBLE' } }));
});
it('pauses rather than sending when a receipt deletion is pending', async () => {
  (tx.deletionRequest.findFirst as jest.Mock).mockResolvedValue({ id: 'request' });
  await refreshOutstandingReminder(tx, delivery, [template]);
  expect(updateMany.mock.calls[0][0].data).toMatchObject({ status: 'PAUSED', failureCode: 'DELETION_PENDING', approvedAt: null });
});
it('cancels after consent is revoked', async () => {
  (tx.customerWhatsAppContact.findFirst as jest.Mock).mockResolvedValue(null);
  await refreshOutstandingReminder(tx, delivery, [template]);
  expect(updateMany.mock.calls[0][0].data.status).toBe('CANCELLED');
});
it('does not send without an approved active image template', async () => {
  await refreshOutstandingReminder(tx, delivery, [{ ...template, active: false }]);
  expect(updateMany.mock.calls[0][0].data).toMatchObject({ status: 'PAUSED', failureCode: 'REMINDER_TEMPLATE_REQUIRED' });
});
it('uses a changed current customer PHONE in production', async () => {
  delivery.testMode = false;
  (tx.systemSetting.findUnique as jest.Mock).mockResolvedValue({ value: JSON.stringify({ reminderEnabled: true, reminderTestMode: false }) });
  (tx.customer.findUnique as jest.Mock).mockResolvedValue({ ...customer, phone: '+224622000000' });
  await refreshOutstandingReminder(tx, delivery, [template]);
  expect(updateMany.mock.calls[0][0].data).toMatchObject({ actualTo: '+224622000000', intendedTo: '+224622000000', status: 'QUEUED' });
});
it('never converts pending test tasks into production tasks', async () => {
  (tx.systemSetting.findUnique as jest.Mock).mockResolvedValue({ value: JSON.stringify({ reminderEnabled: true, reminderTestMode: false }) });
  await refreshOutstandingReminder(tx, delivery, [template]);
  expect(updateMany.mock.calls[0][0].data.status).toBe('CANCELLED');
});
it('does not continuously reset the buffer for unchanged data', async () => {
  await refreshOutstandingReminder(tx, delivery, [template]);
  Object.assign(delivery, updateMany.mock.calls[0][0].data);
  updateMany.mockClear();
  expect(await refreshOutstandingReminder(tx, delivery, [template])).toBe(delivery);
  expect(updateMany).not.toHaveBeenCalled();
});
it('holds an uncertain previous send rather than automatically sending again', async () => {
  (tx.whatsAppDelivery.findFirst as jest.Mock).mockResolvedValue({ status: 'UNCERTAIN' });
  await refreshOutstandingReminder(tx, delivery, [template]);
  expect(updateMany.mock.calls[0][0].data.status).toBe('CANCELLED');
});
