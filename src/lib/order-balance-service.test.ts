import { ReceiptStatus } from '@prisma/client';
import { recordAuditEvent } from '@/lib/audit';
import { logger } from '@/lib/logger';
import {
  calculateLiveOrderBalance,
  repairOrderBalanceCacheIfNeeded,
  updateOrderBalance,
} from './order-balance-service';

jest.mock('@/lib/audit', () => ({
  recordAuditEvent: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockRecordAuditEvent = recordAuditEvent as jest.Mock;
const mockLogger = logger as unknown as {
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
};

function makeClient(order: unknown) {
  return {
    order: {
      findUnique: jest.fn().mockResolvedValue(order),
      update: jest.fn().mockResolvedValue({}),
    },
  } as never;
}

describe('order-balance-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calculates live order balance from amount and linked receipts', async () => {
    const client = makeClient({
      id: 'order-super-dt2-07',
      orderNo: 'SUPER DT2-07',
      amount: 28674,
      orderBalance: 38674,
      receipts: [
        { usd: 10000, status: ReceiptStatus.SR_Received },
        { usd: 15000, status: ReceiptStatus.RECEIVED },
      ],
    });

    await expect(calculateLiveOrderBalance('order-super-dt2-07', client)).resolves.toBe(3674);
  });

  it('updates orderBalance to the computed value', async () => {
    const client = makeClient({
      id: 'order-1',
      orderNo: 'AB-01',
      amount: 1000,
      orderBalance: 1000,
      receipts: [{ usd: 250, status: ReceiptStatus.Bank_Transfer }],
    }) as unknown as { order: { update: jest.Mock } };

    const result = await updateOrderBalance('order-1', client as never, { source: 'receipt:create' });

    expect(result.computed).toBe(750);
    expect(client.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { orderBalance: 750 },
    });
    expect(mockLogger.info).toHaveBeenCalledWith('Order balance cache updated', expect.objectContaining({
      orderId: 'order-1',
      orderNo: 'AB-01',
      source: 'receipt:create',
      before: 1000,
      after: 750,
    }));
  });

  it('repairs mismatched cache once and records audit/log details', async () => {
    const client = makeClient(null) as unknown as { order: { update: jest.Mock } };
    const row = {
      id: 'order-super-dt2-07',
      orderNo: 'SUPER DT2-07',
      amount: 28674,
      orderBalance: 38674,
      receipts: [
        { usd: 10000, status: ReceiptStatus.SR_Received },
        { usd: 15000, status: ReceiptStatus.RECEIVED },
      ],
    };

    const result = await repairOrderBalanceCacheIfNeeded(row, client as never, {
      actorId: 'admin-1',
      source: 'dashboard-summary',
    });

    expect(result.repaired).toBe(true);
    expect(result.comparison).toEqual({
      matches: false,
      stored: 38674,
      computed: 3674,
      difference: -35000,
    });
    expect(client.order.update).toHaveBeenCalledWith({
      where: { id: 'order-super-dt2-07' },
      data: { orderBalance: 3674 },
    });
    expect(mockLogger.warn).toHaveBeenCalledWith('Order balance cache mismatch repaired', expect.objectContaining({
      orderId: 'order-super-dt2-07',
      stored: 38674,
      computed: 3674,
      difference: -35000,
      source: 'dashboard-summary',
    }));
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ORDER_BALANCE_CACHE_REPAIR',
      actorId: 'admin-1',
      targetType: 'ORDER',
      targetId: 'order-super-dt2-07',
      metadata: expect.objectContaining({
        orderNo: 'SUPER DT2-07',
        before: 38674,
        after: 3674,
        difference: -35000,
        source: 'dashboard-summary',
      }),
    }));
  });

  it('does not update or audit when the cache already matches', async () => {
    const client = makeClient(null) as unknown as { order: { update: jest.Mock } };

    const result = await repairOrderBalanceCacheIfNeeded({
      id: 'order-1',
      orderNo: 'AB-01',
      amount: 1000,
      orderBalance: 750,
      receipts: [{ usd: 250, status: ReceiptStatus.RECEIVED }],
    }, client as never, { actorId: 'admin-1', source: 'dashboard-summary' });

    expect(result.repaired).toBe(false);
    expect(client.order.update).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockRecordAuditEvent).not.toHaveBeenCalled();
  });
});
