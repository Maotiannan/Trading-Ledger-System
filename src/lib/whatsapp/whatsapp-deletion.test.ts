/** @jest-environment node */
import { pauseWhatsAppForDeletion } from './whatsapp-deletion';
import type { DbTransactionClient } from '@/lib/transaction';
it('pauses all unsent notifications in the deletion-request transaction', async () => {
  const updateMany = jest.fn();
  const tx = { emailNotification: { findMany: jest.fn(async () => [{ id: 'source' }]) }, whatsAppDelivery: { updateMany } } as unknown as DbTransactionClient;
  await pauseWhatsAppForDeletion(tx, 'RECEIPT', 'receipt');
  expect(updateMany).toHaveBeenCalledWith({ where: { sourceId: { in: ['source'] }, status: { in: ['PENDING', 'QUEUED', 'PAUSED'] }, claimToken: null },
    data: { status: 'PAUSED', failureCode: 'DELETION_PENDING', approvedBy: null, approvedAt: null } });
});
