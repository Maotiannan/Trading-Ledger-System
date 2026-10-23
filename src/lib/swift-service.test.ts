import { Prisma, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { canAccessOwnedResourceAsync } from '@/lib/ownership';
import { getNumericSystemSetting } from '@/lib/system-settings';
import { createSwiftRecord, deleteSwiftRecord, markSwiftReceived, updateSwiftRecord } from './swift-service';

jest.mock('@/lib/db', () => ({ db: {
  detail: { findUnique: jest.fn(), update: jest.fn() },
  swift: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), updateMany: jest.fn() },
  receipt: { updateMany: jest.fn() }, uploadedAsset: { updateMany: jest.fn() },
  $queryRaw: jest.fn(), $transaction: jest.fn(),
} }));
jest.mock('@/lib/ownership', () => ({ canAccessOwnedResourceAsync: jest.fn() }));
jest.mock('@/lib/audit', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('@/lib/system-settings', () => ({ getNumericSystemSetting: jest.fn() }));

const user = { id: 'admin', email: 'admin@example.com', name: 'Admin', role: UserRole.ADMIN, level: 1, parentId: null, createdById: null };
const payload = (amount: number) => ({ amount, date: '2026-10-21', senderName: 'Mitty', senderAddress: null, receiverName: null, receiverAccount: null });
type Row = { id: string; detailId: string; amount: Prisma.Decimal; status: 'Bank_Transfer' | 'RECEIVED' | 'ERROR'; hasError: boolean; createdBy: string; imageUrl?: string };
const mocks = db as unknown as {
  detail: { findUnique: jest.Mock; update: jest.Mock };
  swift: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock; updateMany: jest.Mock };
  receipt: { updateMany: jest.Mock }; uploadedAsset: { updateMany: jest.Mock };
  $queryRaw: jest.Mock; $transaction: jest.Mock;
};
let rows: Row[];
let detail: { id: string; createdBy: string; totalAmount: Prisma.Decimal; status: string; items: { receiptId: string }[] };
function add(amount: number, status: Row['status'] = 'Bank_Transfer', hasError = false) {
  const row: Row = { id: `swift-${rows.length + 1}`, detailId: 'detail', amount: new Prisma.Decimal(amount), status, hasError, createdBy: 'admin' };
  rows.push(row);
  return row;
}

beforeEach(() => {
  jest.resetAllMocks();
  rows = [];
  detail = { id: 'detail', createdBy: 'admin', totalAmount: new Prisma.Decimal(75093), status: 'Waiting_SWIFT', items: [{ receiptId: 'receipt' }] };
  (canAccessOwnedResourceAsync as jest.Mock).mockResolvedValue(true);
  (getNumericSystemSetting as jest.Mock).mockResolvedValue(40);
  mocks.$transaction.mockImplementation((callback) => callback(mocks));
  mocks.detail.findUnique.mockImplementation(async () => ({ ...detail, swifts: rows.map((row) => ({ ...row })) }));
  mocks.detail.update.mockImplementation(async ({ data }) => Object.assign(detail, data));
  mocks.swift.findUnique.mockImplementation(async ({ where, include }) => {
    const row = rows.find((row) => row.id === where.id);
    return row ? { ...row, ...(include ? { detail: { ...detail, swifts: rows.map((row) => ({ ...row })) } } : {}) } : null;
  });
  mocks.swift.create.mockImplementation(async ({ data }) => {
    const row = add(data.amount);
    Object.assign(row, data, { amount: new Prisma.Decimal(data.amount) });
    return { ...row };
  });
  mocks.swift.update.mockImplementation(async ({ where, data }) => {
    const row = rows.find((row) => row.id === where.id)!;
    Object.assign(row, data, data.amount ? { amount: new Prisma.Decimal(data.amount) } : {});
    return { ...row };
  });
  mocks.swift.delete.mockImplementation(async ({ where }) => { rows = rows.filter((row) => row.id !== where.id); });
  mocks.uploadedAsset.updateMany.mockResolvedValue({ count: 1 });
});

it('allows multiple copies after the first was signed and completes only after the last is signed', async () => {
  const first = await createSwiftRecord({ currentUser: user, detailId: 'detail', payload: payload(50000), mode: 'confirm' });
  await markSwiftReceived({ currentUser: user, swiftId: first.swift.id });
  expect(detail.status).toBe('Waiting_SWIFT');
  expect(mocks.receipt.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'RECEIVED' } }));
  const second = await createSwiftRecord({ currentUser: user, detailId: 'detail', payload: payload(25093), mode: 'direct-create' });
  expect(rows[0].status).toBe('RECEIVED');
  expect(rows[1].status).toBe('Bank_Transfer');
  expect(second.summary.remainingAmount).toBe(0);
  expect(detail.status).toBe('Bank_Transfer');
  await markSwiftReceived({ currentUser: user, swiftId: second.swift.id });
  expect(detail.status).toBe('RECEIVED');
  expect(mocks.swift.updateMany).not.toHaveBeenCalled();
});

it('handles eight independent transfers with bank fees', async () => {
  detail.totalAmount = new Prisma.Decimal(80000);
  for (let n = 0; n < 8; n++) {
    const created = await createSwiftRecord({ currentUser: user, detailId: 'detail', payload: payload(9980), mode: 'direct-create' });
    await markSwiftReceived({ currentUser: user, swiftId: created.swift.id });
    expect(detail.status).toBe(n === 7 ? 'RECEIVED' : 'Waiting_SWIFT');
  }
  await expect(createSwiftRecord({ currentUser: user, detailId: 'detail', payload: payload(160), mode: 'direct-create' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
});

it('rejects aggregate overpayment without creating another copy', async () => {
  add(50000, 'RECEIVED');
  await expect(createSwiftRecord({ currentUser: user, detailId: 'detail', payload: payload(25093.01), mode: 'confirm' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  expect(mocks.swift.create).not.toHaveBeenCalled();
});

it('does not reopen an already received payment detail through a new upload', async () => {
  detail.status = 'RECEIVED';
  await expect(createSwiftRecord({ currentUser: user, detailId: 'detail', payload: payload(100), mode: 'confirm' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(mocks.swift.create).not.toHaveBeenCalled();
});

it('recalculates remaining copies on deletion', async () => {
  const first = add(50000, 'RECEIVED');
  add(25093, 'RECEIVED');
  detail.status = 'RECEIVED';
  await deleteSwiftRecord({ currentUser: user, swiftId: first.id });
  expect(detail.status).toBe('Waiting_SWIFT');
  expect(rows[0].status).toBe('RECEIVED');
  await deleteSwiftRecord({ currentUser: user, swiftId: rows[0].id });
  expect(detail.status).toBe('Waiting_SWIFT');
});

it('checks edits against other received copies and preserves their state', async () => {
  add(50000, 'RECEIVED');
  const second = add(20000);
  await updateSwiftRecord({ currentUser: user, swiftId: second.id, payload: payload(25093) });
  expect(rows[0].status).toBe('RECEIVED');
  await expect(updateSwiftRecord({ currentUser: user, swiftId: second.id, payload: payload(25094) })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
});

it('does not allow edits to received copies', async () => {
  const row = add(50000, 'RECEIVED');
  await expect(updateSwiftRecord({ currentUser: user, swiftId: row.id, payload: payload(50001) })).rejects.toThrow('RECEIVED状态下禁止修改SWIFT');
});

it('retains error copies without counting them and attaches new uploaded assets', async () => {
  add(100000, 'ERROR', true);
  const result = await createSwiftRecord({ currentUser: user, detailId: 'detail', payload: payload(50000), mode: 'confirm', imagePath: '/upload/images/swifts/ocr/new.pdf' });
  expect(result.summary.transferredAmount).toBe(50000);
  expect(rows).toHaveLength(2);
  expect(mocks.uploadedAsset.updateMany).toHaveBeenCalled();
});

it('aborts when the staged asset cannot be attached', async () => {
  mocks.uploadedAsset.updateMany.mockResolvedValue({ count: 0 });
  await expect(createSwiftRecord({ currentUser: user, detailId: 'detail', payload: payload(50000), mode: 'confirm', imagePath: '/upload/images/swifts/ocr/missing.pdf' })).rejects.toThrow('Expected to attach exactly one staged uploaded asset');
});

it('enforces ownership and admin-only signing', async () => {
  (canAccessOwnedResourceAsync as jest.Mock).mockResolvedValue(false);
  await expect(createSwiftRecord({ currentUser: user, detailId: 'detail', payload: payload(50000), mode: 'confirm' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const row = add(50000);
  await expect(markSwiftReceived({ currentUser: { ...user, role: UserRole.SALES }, swiftId: row.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

it('uses parent row locking and read-committed transactions for aggregate writes', async () => {
  await createSwiftRecord({ currentUser: user, detailId: 'detail', payload: payload(50000), mode: 'confirm' });
  expect(mocks.$queryRaw).toHaveBeenCalled();
  expect(mocks.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'ReadCommitted' });
});
