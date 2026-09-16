jest.mock('@/lib/transaction', () => ({ runInTransaction: jest.fn() }));
import { runInTransaction } from '@/lib/transaction';
import { runWhatsAppTransaction } from './whatsapp-transaction';
beforeEach(() => jest.resetAllMocks());
it('retries a duplicate/deadlock in a fresh transaction', async () => {
  (runInTransaction as jest.Mock).mockRejectedValueOnce({ code: 'P2002' }).mockRejectedValueOnce({ code: 'P2034' }).mockResolvedValueOnce('stored');
  await expect(runWhatsAppTransaction(async () => 'stored')).resolves.toBe('stored');
  expect(runInTransaction).toHaveBeenCalledTimes(3);
});
it('does not retry unknown/network errors', async () => {
  (runInTransaction as jest.Mock).mockRejectedValue(new Error('unknown'));
  await expect(runWhatsAppTransaction(async () => null)).rejects.toThrow('unknown');
  expect(runInTransaction).toHaveBeenCalledTimes(1);
});
