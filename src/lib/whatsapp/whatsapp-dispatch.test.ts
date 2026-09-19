/** @jest-environment node */
jest.mock('./whatsapp-refresh', () => ({ refreshWhatsAppInTransaction: jest.fn() }));
jest.mock('./whatsapp-template-service', () => ({ listWhatsAppTemplateVersions: jest.fn(async () => []) }));
jest.mock('./ycloud-template-status', () => ({ isYCloudTemplateApproved: jest.fn(async () => true) }));
jest.mock('./whatsapp-settings', () => ({ getWhatsAppSettings: jest.fn(async () => ({outboundEnabled:true,testMode:true,testDestination:'+8613619767412'})) }));

jest.mock('@/lib/db', () => ({ db: { whatsAppDelivery: { updateMany: jest.fn(), findUnique: jest.fn() } } }));
jest.mock('@/lib/transaction', () => ({ runInTransaction: jest.fn() }));
jest.mock('./whatsapp-queue', () => ({ claimWhatsAppInTransaction: jest.fn() }));
jest.mock('./ycloud-provider', () => ({
  ...jest.requireActual('./ycloud-provider'), sendYCloudTemplate: jest.fn(),
}));
import { db } from '@/lib/db';
import { runInTransaction } from '@/lib/transaction';
import { claimWhatsAppInTransaction } from './whatsapp-queue';
import { sendYCloudTemplate, WhatsAppProviderError } from './ycloud-provider';
import { dispatchWhatsAppDelivery } from './whatsapp-dispatch';
const original = { ...process.env };
import { refreshWhatsAppInTransaction } from './whatsapp-refresh';
const row = { nextSendAt: new Date(0), status: 'QUEUED', sourceId: 'source', businessSnapshot: { amount: 100, orderNos: ['ORDER-1'] }, id: 'delivery', claimToken: 'claim', senderPhone: '+123456789', parameters: ['100'], actualTo: '+224620123456', templateName: 'payment', languageCode: 'en' };
beforeEach(() => {
  jest.clearAllMocks();
  (refreshWhatsAppInTransaction as jest.Mock).mockResolvedValue(row);
  Object.assign(process.env, { YCLOUD_API_KEY: 'mock-key', YCLOUD_SENDER_PHONE: row.senderPhone, WHATSAPP_OUTBOUND_ENABLED: 'true' });
  (runInTransaction as jest.Mock).mockImplementation(async fn => fn({ receipt: { findUnique: jest.fn().mockResolvedValue({customerId:'customer',status:'SR_Received',receiptNo:'R-1',usd:100,orderNo:'ORDER-1'}) }, emailNotification: { findUnique: jest.fn().mockResolvedValue({status:'PENDING',receiptId:'receipt',customerId:'customer',currentSnapshot:row.businessSnapshot}) }, whatsAppDelivery: { findUnique: jest.fn().mockResolvedValue(row) } }));
  (db.whatsAppDelivery.findUnique as jest.Mock).mockResolvedValue(row);
  (claimWhatsAppInTransaction as jest.Mock).mockResolvedValue(row);
  (sendYCloudTemplate as jest.Mock).mockResolvedValue({ providerMessageId: 'provider' });
  (db.whatsAppDelivery.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
});
afterEach(() => { process.env = { ...original }; });
it('sends the frozen snapshot once with delivery correlation', async () => {
  expect(await dispatchWhatsAppDelivery('delivery')).toMatchObject({ sent: true });
  expect(sendYCloudTemplate).toHaveBeenCalledTimes(1);
  expect(sendYCloudTemplate).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'delivery', to: row.actualTo }), expect.anything());
  expect(db.whatsAppDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'delivery', claimToken: 'claim', status: 'SENDING' } }));
});
it('never sends when outbound is disabled or claim is lost', async () => {
  process.env.WHATSAPP_OUTBOUND_ENABLED = 'false';
  await dispatchWhatsAppDelivery('delivery');
  expect(sendYCloudTemplate).not.toHaveBeenCalled();
  process.env.WHATSAPP_OUTBOUND_ENABLED = 'true';
  (claimWhatsAppInTransaction as jest.Mock).mockResolvedValue(null);
  await dispatchWhatsAppDelivery('delivery');
  expect(sendYCloudTemplate).not.toHaveBeenCalled();
});
it('records timeout uncertainty without a retry', async () => {
  (sendYCloudTemplate as jest.Mock).mockRejectedValue(new Error('timeout'));
  expect(await dispatchWhatsAppDelivery('delivery')).toMatchObject({ uncertain: true });
  expect(sendYCloudTemplate).toHaveBeenCalledTimes(1);
  expect(db.whatsAppDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'UNCERTAIN', failureCode: 'TRANSPORT_UNCERTAIN' } }));
});
it('records explicit rejection', async () => {
  (sendYCloudTemplate as jest.Mock).mockRejectedValue(new WhatsAppProviderError('REJECTED', '400', 'bad'));
  await dispatchWhatsAppDelivery('delivery');
  expect(db.whatsAppDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'FAILED', failureCode: 'PROVIDER_REJECTED' } }));
});
it('propagates persistence failure rather than resending or marking provider rejection', async () => {
  (db.whatsAppDelivery.updateMany as jest.Mock).mockRejectedValue(new Error('write failed'));
  await expect(dispatchWhatsAppDelivery('delivery')).rejects.toThrow('write failed');
  expect(sendYCloudTemplate).toHaveBeenCalledTimes(1);
  expect(db.whatsAppDelivery.updateMany).toHaveBeenCalledTimes(1);
});
