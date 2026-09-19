/** @jest-environment node */
jest.mock('./whatsapp-live-source', () => ({ resolveWhatsAppSource: jest.fn() }));
jest.mock('@/lib/db', () => ({ db: { whatsAppDelivery: { findMany: jest.fn() } } }));
jest.mock('./whatsapp-transaction', () => ({ runWhatsAppTransaction: jest.fn() }));
import { projectWhatsAppCorrections, refreshCorrectionInTransaction } from './whatsapp-corrections';
import { db } from '@/lib/db';
import { runWhatsAppTransaction } from './whatsapp-transaction';
import { resolveWhatsAppSource } from './whatsapp-live-source';
import type { DbTransactionClient } from '@/lib/transaction';
import type { WhatsAppDelivery } from '@prisma/client';

const original = { id: 'sent-a', type: 'PAYMENT_RECEIVED', sourceId: 'source-a', parameters: ['old'], businessSnapshot: { receiptNo: 'A', amount: 2000 } };
const correction = { id: 'correction', correctionOf: ['sent-a'], status: 'PENDING', updatedAt: new Date(0),
  businessSnapshot: { orderId: 'order', customerId: 'customer' }, intendedTo: '+224620123456', actualTo: '+224620123456' } as unknown as WhatsAppDelivery;
const updateMany = jest.fn();
const tx = { whatsAppDelivery: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => [original]), updateMany, findUnique: jest.fn(async () => correction) },
  emailNotification: { findUnique: jest.fn(async () => ({ id: 'source-a' })) },
  order: { findFirst: jest.fn(async () => ({ amount: 10000, orderNo: 'ORDER-1', invoice: { invNo: 'INV' }, receipts: [{ usd: 3000, status: 'RECEIVED' }],
    customer: { id: 'customer', name: 'Client', mark: 'MARK', phone: '+224620123456', notificationLanguage: 'ENGLISH' } })) },
  customerWhatsAppContact: { findFirst: jest.fn(async () => ({ id: 'contact' })) },
} as unknown as DbTransactionClient;
beforeEach(() => { jest.clearAllMocks(); (resolveWhatsAppSource as jest.Mock).mockResolvedValue(null); updateMany.mockResolvedValue({ count: 1 }); });
it('makes deletion correction explicit with amount and current balance, never rewriting the sent message', async () => {
  await refreshCorrectionInTransaction(tx, correction, []);
  expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'correction' }), data: expect.objectContaining({
    status: 'PENDING', requiresApproval: true, approvedAt: null, templateName: 'muledger_correction_v1',
    parameters: expect.arrayContaining(['7,000', expect.stringContaining('A (USD 2,000)')]),
  }) }));
  expect(original.parameters).toEqual(['old']);
});
it('holds correction while a related deletion is still pending', async () => {
  (resolveWhatsAppSource as jest.Mock).mockResolvedValue({ paused: true });
  await refreshCorrectionInTransaction(tx, correction, []);
  expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'PAUSED', failureCode: 'DELETION_PENDING', approvedBy: null, approvedAt: null } }));
});
it('groups affected receipts for one customer/order into a single admin-reviewed correction', async () => {
  const originals = ['sent-a', 'sent-b'].map(id => ({ ...original, id, businessSnapshot: { ...original.businessSnapshot, orderId: 'order', customerId: 'customer' }, testMode: false }));
  (db.whatsAppDelivery.findMany as jest.Mock).mockResolvedValue(originals);
  const create = jest.fn(async () => correction);
  const groupedTx = { ...tx, whatsAppDelivery: { ...tx.whatsAppDelivery,
    findUnique: jest.fn(async ({ where }) => where.eventKey ? null : correction), create,
  } };
  (runWhatsAppTransaction as jest.Mock).mockImplementation(fn => fn(groupedTx));
  await projectWhatsAppCorrections([]);
  expect(create).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    correctionOf: ['sent-a', 'sent-b'], requiresApproval: true, status: 'PENDING', testMode: false,
  }) }));
});
