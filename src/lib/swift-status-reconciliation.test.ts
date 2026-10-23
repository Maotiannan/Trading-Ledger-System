import { db } from '@/lib/db';
import { reconcilePartialSwiftStatuses } from './swift-status-reconciliation';

jest.mock('@/lib/db', () => ({ db: {
  user: { findUnique: jest.fn() }, detail: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  receipt: { updateMany: jest.fn() }, auditLog: { create: jest.fn() }, $queryRaw: jest.fn(), $transaction: jest.fn(),
} }));
jest.mock('@/lib/system-settings', () => ({ getNumericSystemSetting: jest.fn().mockResolvedValue(40) }));

const mock = db as unknown as {
  user: { findUnique: jest.Mock }; detail: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  receipt: { updateMany: jest.Mock }; auditLog: { create: jest.Mock }; $queryRaw: jest.Mock; $transaction: jest.Mock;
};
const partial = { id: 'partial', totalAmount: 75093, status: 'Bank_Transfer',
  swifts: [{ amount: 50000, status: 'RECEIVED', hasError: false }],
  items: [{ receiptId: 'receipt', receipt: { id: 'receipt', status: 'Bank_Transfer' } }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mock.user.findUnique.mockResolvedValue({ role: 'ADMIN' });
  mock.detail.findMany.mockResolvedValue([
    partial, { ...partial, id: 'covered', totalAmount: 50000 },
    { ...partial, id: 'errors-only', swifts: [{ amount: 50000, status: 'ERROR', hasError: true }] },
  ]);
  mock.detail.findUnique.mockResolvedValue(partial);
  mock.$transaction.mockImplementation((fn) => fn(mock));
  mock.auditLog.create.mockResolvedValue({});
});

it('previews partial candidates without changing any rows', async () => {
  expect(await reconcilePartialSwiftStatuses()).toEqual({ mode: 'dry-run', candidates: ['partial'], changed: [] });
  expect(mock.$transaction).not.toHaveBeenCalled();
  expect(mock.detail.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'Bank_Transfer', swifts: { some: {} } } }));
});

it('requires an existing ADMIN actor for apply', async () => {
  await expect(reconcilePartialSwiftStatuses({ apply: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  mock.user.findUnique.mockResolvedValue({ role: 'SALES' });
  await expect(reconcilePartialSwiftStatuses({ apply: true, actorId: 'sales' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(mock.$transaction).not.toHaveBeenCalled();
});

it('locks, synchronizes and audits state changes in one transaction', async () => {
  expect((await reconcilePartialSwiftStatuses({ apply: true, actorId: 'admin' })).changed).toEqual(['partial']);
  expect(mock.$queryRaw).toHaveBeenCalled();
  expect(mock.detail.update).toHaveBeenCalledWith({ where: { id: 'partial' }, data: { status: 'Waiting_SWIFT' } });
  expect(mock.receipt.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'Waiting_SWIFT' } }));
  expect(mock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    action: 'SWIFT_PARTIAL_STATUS_RECONCILE', actorId: 'admin',
    metadata: expect.objectContaining({ before: 'Bank_Transfer', after: 'Waiting_SWIFT', receiptsBefore: [{ id: 'receipt', status: 'Bank_Transfer' }] }),
  }) }));
  expect(mock.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'ReadCommitted' });
});

it('rechecks state under the lock and skips concurrent completion', async () => {
  mock.detail.findUnique.mockResolvedValue({ ...partial, status: 'RECEIVED' });
  expect((await reconcilePartialSwiftStatuses({ apply: true, actorId: 'admin' })).changed).toEqual([]);
  expect(mock.detail.update).not.toHaveBeenCalled();
  expect(mock.auditLog.create).not.toHaveBeenCalled();
});

it('is idempotent after correction and propagates audit failures for rollback', async () => {
  mock.auditLog.create.mockRejectedValueOnce(new Error('audit unavailable'));
  await expect(reconcilePartialSwiftStatuses({ apply: true, actorId: 'admin' })).rejects.toThrow('audit unavailable');
  mock.detail.findMany.mockResolvedValue([]);
  expect((await reconcilePartialSwiftStatuses({ apply: true, actorId: 'admin' })).changed).toEqual([]);
});
