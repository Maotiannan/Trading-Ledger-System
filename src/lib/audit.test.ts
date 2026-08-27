import { recordAuditEventInTransaction } from '@/lib/audit';

jest.mock('@/lib/db', () => ({
  db: {},
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('transactional audit', () => {
  const event = {
    action: 'ORDER_TRANSFER_BALANCE_REVERSE',
    actorId: 'admin-1',
    targetType: 'BALANCE_TRANSFER',
    targetId: 'transfer-1',
    metadata: { amount: 3213 },
    at: '2026-08-27T05:00:00.000Z',
  };

  it('writes through the supplied transaction client', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const tx = { auditLog: { create } };

    await recordAuditEventInTransaction(tx, event);

    expect(create).toHaveBeenCalledWith({
      data: {
        action: event.action,
        actorId: event.actorId,
        targetType: event.targetType,
        targetId: event.targetId,
        metadata: event.metadata,
        createdAt: new Date(event.at),
      },
    });
  });

  it('propagates audit failures so the caller transaction can roll back', async () => {
    const tx = {
      auditLog: {
        create: jest.fn().mockRejectedValue(new Error('audit unavailable')),
      },
    };

    await expect(recordAuditEventInTransaction(tx, event)).rejects.toThrow('audit unavailable');
  });
});
