/** @jest-environment node */
import { enqueueWhatsAppInTransaction, approveWhatsAppTestInTransaction, claimWhatsAppInTransaction, cancelWhatsAppInTransaction } from './whatsapp-queue';
import type { DbTransactionClient } from '@/lib/transaction';
import type { CurrentUser } from '@/lib/request-auth';

const contact = { customerId: 'customer', id: 'contact', customer: {phone:'+224620123456'}, phone: '+224620123456', optedInAt: new Date('2026-01-01'), optedOutAt: null };
const input = { eventKey: 'payment:receipt:contact', type: 'PAYMENT_RECEIVED' as const, sourceId: 'receipt', contactId: 'contact', testMode: true, testDestination: '+8613619767412', senderPhone: '+8613819858718', templateName: 'payment', languageCode: 'en', parameters: [], businessSnapshot: { balance: 123 } };
const upsert = jest.fn();
const findExisting = jest.fn();
const updateMany = jest.fn();
const findUnique = jest.fn();
const findContact = jest.fn();
const tx = { whatsAppDelivery: { findFirst: findExisting, upsert, updateMany, findUnique }, customerWhatsAppContact: { findUnique: findContact } } as unknown as DbTransactionClient;
beforeEach(() => { jest.resetAllMocks(); findContact.mockResolvedValue(contact); updateMany.mockResolvedValue({ count: 1 }); });
it('test events freeze both intended and actual recipients and await approval', async () => {
  await enqueueWhatsAppInTransaction(tx, input);
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {}, create: expect.objectContaining({ status: 'PENDING', intendedTo: contact.phone, actualTo: input.testDestination, testMode: true }) }));
});
it('production events queue directly', async () => {
  await enqueueWhatsAppInTransaction(tx, { ...input, testMode: false });
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ status: 'QUEUED', actualTo: contact.phone }) }));
});
it.each([{ ...contact, optedInAt: null }, { ...contact, optedOutAt: new Date('2026-02-01') }])('refuses missing or revoked consent', async (row) => {
  findContact.mockResolvedValue(row);
  expect(await enqueueWhatsAppInTransaction(tx, input)).toMatchObject({ reason: 'CONSENT_REQUIRED' });
  expect(upsert).not.toHaveBeenCalled();
});
it('refuses a test task without a test destination', async () => {
  await expect(enqueueWhatsAppInTransaction(tx, { ...input, testDestination: undefined })).rejects.toThrow();
  expect(upsert).not.toHaveBeenCalled();
});
it('only ADMIN can approve', async () => {
  await expect(approveWhatsAppTestInTransaction(tx, 'delivery', { role: 'SALES' } as CurrentUser)).rejects.toThrow('Administrator');
  expect(updateMany).not.toHaveBeenCalled();
  await approveWhatsAppTestInTransaction(tx, 'delivery', { id: 'admin', role: 'ADMIN' } as CurrentUser);
  expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'delivery', status: 'PENDING', OR: [{ testMode: true }, { requiresApproval: true }] }, data: expect.objectContaining({ approvedBy: 'admin' }) }));
});
const delivery = { nextSendAt: new Date(0), updatedAt: new Date(0), id: 'delivery', contact, status: 'QUEUED', testMode: true, actualTo: input.testDestination, intendedTo: contact.phone, approvedBy: 'admin', approvedAt: new Date() };
const settings = { outboundEnabled: true, testMode: true, testDestination: input.testDestination };
it.each([
  { ...delivery, testMode: false }, { ...delivery, approvedBy: null },
  { ...delivery, actualTo: '+123456789' }, { ...delivery, status: 'SENDING' },
  { ...delivery, contact: { ...contact, optedOutAt: new Date() } },
])('does not claim ineligible task', async (row) => {
  findUnique.mockResolvedValue(row);
  expect(await claimWhatsAppInTransaction(tx, 'delivery', settings)).toBeNull();
  expect(updateMany).not.toHaveBeenCalled();
});
it('atomically claims once and loses concurrent claims safely', async () => {
  findUnique.mockResolvedValue(delivery);
  expect(await claimWhatsAppInTransaction(tx, 'delivery', settings)).toMatchObject({ status: 'SENDING' });
  expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'delivery', status: 'QUEUED', claimToken: null }) }));
  updateMany.mockResolvedValue({ count: 0 });
  expect(await claimWhatsAppInTransaction(tx, 'delivery', settings)).toBeNull();
});
it('outbound off never reads tasks', async () => {
  expect(await claimWhatsAppInTransaction(tx, 'delivery', { ...settings, outboundEnabled: false })).toBeNull();
  expect(findUnique).not.toHaveBeenCalled();
});

it('uses changed customer PHONE for a queued production delivery without changing consent', async () => {
  findUnique.mockResolvedValue({...delivery,testMode:false,actualTo:'+224620123456',contact:{...contact,customer:{phone:'+224 622 49 12 86'}}});
  expect(await claimWhatsAppInTransaction(tx,'delivery',{...settings,testMode:false})).toMatchObject({actualTo:'+224622491286',intendedTo:'+224622491286'});
  expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({actualTo:'+224622491286'})}));
});
it('test mode remains pinned to test destination after a customer PHONE change', async () => {
  findUnique.mockResolvedValue({...delivery,contact:{...contact,customer:{phone:'+224622491286'}}});
  expect(await claimWhatsAppInTransaction(tx,'delivery',settings)).toMatchObject({actualTo:input.testDestination,intendedTo:'+224622491286'});
});
it('invalid new PHONE blocks sending instead of falling back to old consent phone', async () => {
  findUnique.mockResolvedValue({...delivery,contact:{...contact,customer:{phone:'622491286'}}});
  expect(await claimWhatsAppInTransaction(tx,'delivery',settings)).toBeNull();
  expect(updateMany).not.toHaveBeenCalled();
});
it.each(['SENT','DELIVERED','UNCERTAIN','SENDING'])('never rewrites a %s recipient or resends it after PHONE changes', async status => {
  findUnique.mockResolvedValue({...delivery,status,contact:{...contact,customer:{phone:'+224622491286'}}});
  expect(await claimWhatsAppInTransaction(tx,'delivery',settings)).toBeNull();
  expect(updateMany).not.toHaveBeenCalled();
});

it('keeps a historical contact-keyed delivery instead of creating a duplicate customer-keyed task',async()=>{
  findExisting.mockResolvedValue({id:'original',status:'SENT'});
  expect(await enqueueWhatsAppInTransaction(tx,input)).toEqual({delivery:{id:'original',status:'SENT'}});
  expect(upsert).not.toHaveBeenCalled();
});

it('never claims before the persisted five minute deadline', async () => {
  findUnique.mockResolvedValue({ ...delivery, nextSendAt: new Date(Date.now() + 300000) });
  expect(await claimWhatsAppInTransaction(tx, 'delivery', settings)).toBeNull();
  expect(updateMany).not.toHaveBeenCalled();
});
it('cancellation wins only while unsent and creates an audit entry', async () => {
  const auditLog = { create: jest.fn() };
  await cancelWhatsAppInTransaction({ ...tx, auditLog } as unknown as DbTransactionClient, 'delivery', { id: 'admin', role: 'ADMIN' } as CurrentUser);
  expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'delivery', status: { in: ['PENDING', 'QUEUED', 'PAUSED'] }, claimToken: null }, data: { status: 'CANCELLED', failureCode: 'ADMIN_CANCELLED' } }));
  expect(auditLog.create).toHaveBeenCalledTimes(1);
  updateMany.mockResolvedValue({ count: 0 });
  await expect(cancelWhatsAppInTransaction({ ...tx, auditLog } as unknown as DbTransactionClient, 'delivery', { id: 'admin', role: 'ADMIN' } as CurrentUser)).rejects.toMatchObject({ status: 409 });
  expect(auditLog.create).toHaveBeenCalledTimes(1);
});
