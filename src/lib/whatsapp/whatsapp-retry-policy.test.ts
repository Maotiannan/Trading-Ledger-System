/** @jest-environment node */
import type { WhatsAppDelivery } from '@prisma/client';
import { failedRetryAncestors, isExplicitWhatsAppFailure } from './whatsapp-retry-policy';

const base = { id: 'failed', status: 'FAILED', failureCode: 'BALANCE_INSUFFICIENT', providerMessageId: 'provider',
  retryOf: null, type: 'OUTSTANDING_REMINDER', sourceId: 'source', testMode: false } as unknown as WhatsAppDelivery;

it('allows only explicit provider failures, never uncertain or delivered rows', () => {
  expect(isExplicitWhatsAppFailure(base)).toBe(true);
  expect(isExplicitWhatsAppFailure({ ...base, providerMessageId: null, failureCode: 'PROVIDER_REJECTED' })).toBe(true);
  expect(isExplicitWhatsAppFailure({ ...base, providerMessageId: null, failureCode: 'REMINDER_IMAGE_FAILED' })).toBe(true);
  expect(isExplicitWhatsAppFailure({ ...base, status: 'UNCERTAIN' })).toBe(false);
  expect(isExplicitWhatsAppFailure({ ...base, status: 'DELIVERED' })).toBe(false);
  expect(isExplicitWhatsAppFailure({ ...base, failureCode: null })).toBe(false);
});

it('walks a retry chain only while every parent remains the same failed event', async () => {
  const parent = { ...base, id: 'parent', retryOf: null };
  const findUnique = jest.fn(async ({ where: { id } }: { where: { id: string } }) => id === 'parent' ? parent : null);
  expect(await failedRetryAncestors({ whatsAppDelivery: { findUnique } } as any, { ...base, retryOf: 'parent' })).toEqual([parent]);
  findUnique.mockResolvedValue({ ...parent, sourceId: 'different' });
  expect(await failedRetryAncestors({ whatsAppDelivery: { findUnique } } as any, { ...base, retryOf: 'parent' })).toBeNull();
});
