import type { Prisma } from '@prisma/client';

import {
  applyMuContractOrderState,
  type MuContractApplyResult,
} from '@/lib/integrations/mu-contract-order-applier';
import { resolveMuContractOrderCustomer } from '@/lib/integrations/mu-contract-customer-resolver';
import type { MuContractOrderEvent } from '@/lib/integrations/mu-contract-contract';

jest.mock('@/lib/integrations/mu-contract-customer-resolver', () => ({
  resolveMuContractOrderCustomer: jest.fn(),
}));

const mockResolveCustomer = resolveMuContractOrderCustomer as jest.Mock;

function makeEvent(overrides: {
  cursor?: string;
  version?: number;
  orderNo?: string;
  previousOrderNo?: string | null;
  active?: boolean;
  deletedAt?: string | null;
  eventType?: MuContractOrderEvent['eventType'];
  reason?: MuContractOrderEvent['reason'];
  currency?: string | null;
  amount?: string | null;
  piId?: string;
} = {}): MuContractOrderEvent {
  const active = overrides.active ?? true;
  const currency = overrides.currency === undefined ? 'USD' : overrides.currency;
  const amount = overrides.amount === undefined ? '12000.00' : overrides.amount;
  return {
    cursor: overrides.cursor ?? '2',
    eventId: 'c5a5c257-b3ec-4ce2-b54d-83f8f1aab7e2',
    eventType: overrides.eventType ?? 'PI_ORDER_LINKED',
    reason: overrides.reason ?? 'ORDER_ASSIGNED',
    occurredAt: '2026-07-18T08:00:00.000Z',
    source: {
      system: 'MU_CONTRACT',
      piId: overrides.piId ?? 'pi-1',
      version: overrides.version ?? 2,
    },
    order: {
      orderNo: overrides.orderNo ?? 'AB-12',
      previousOrderNo: overrides.previousOrderNo ?? null,
      piCreatedAt: '2026-07-01T09:00:00.000Z',
      active,
      deletedAt: overrides.deletedAt ?? (active ? null : '2026-07-18T08:00:00.000Z'),
    },
    officialAmount: currency && amount
      ? {
          currency,
          value: amount,
          generatedAt: '2026-07-18T07:59:00.000Z',
          generationRunId: 'pi-1',
        }
      : null,
  };
}

function manualRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'manual-1',
    orderNo: 'AB-12',
    normalizedOrderNo: 'ab-12',
    customerId: 'customer-manual',
    needsCustomerFix: false,
    status: 'Confirmed',
    piStatus: true,
    remark: 'keep me',
    systemNote: 'approved',
    confirmedAt: new Date('2026-07-10T00:00:00.000Z'),
    archivedAt: null,
    ...overrides,
  };
}

function sourceLink(overrides: Record<string, unknown> = {}) {
  const row = manualRow({
    id: 'sync-old',
    orderNo: 'AB-11',
    normalizedOrderNo: 'ab-11',
    customerId: null,
    needsCustomerFix: true,
    status: 'In progress',
    piStatus: false,
    remark: null,
    systemNote: null,
    confirmedAt: null,
  });
  return {
    id: 'link-1',
    provider: 'MU_CONTRACT',
    externalId: 'pi-1',
    sourceVersion: 1,
    sourceOrderNo: 'AB-11',
    normalizedSourceOrderNo: 'ab-11',
    orderTrackerId: row.id,
    orderTracker: row,
    linkMode: 'SYNC_CREATED',
    humanEditedAt: null,
    customerMatchStatus: 'UNMATCHED',
    active: true,
    ...overrides,
  };
}

function makeTx() {
  return {
    externalOrderSourceLink: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }) => ({ id: 'link-created', ...data })),
      update: jest.fn(async ({ data }) => ({ id: 'link-1', ...data })),
    },
    orderTracker: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }) => ({ id: 'sync-created', ...data })),
      update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
    },
    integrationSyncConflict: {
      upsert: jest.fn(async ({ create }) => ({ id: 'conflict-1', ...create })),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    order: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    invoice: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    receipt: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    detail: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    swift: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  };
}

function asTx(value: ReturnType<typeof makeTx>): Prisma.TransactionClient {
  return value as unknown as Prisma.TransactionClient;
}

async function apply(
  tx: ReturnType<typeof makeTx>,
  state = makeEvent(),
): Promise<MuContractApplyResult> {
  return applyMuContractOrderState(asTx(tx), {
    state,
    actorId: 'service-admin',
    cursor: state.cursor,
  });
}

function expectNoFinancialWrites(tx: ReturnType<typeof makeTx>): void {
  for (const delegate of [tx.order, tx.invoice, tx.receipt, tx.detail, tx.swift]) {
    expect(delegate.create).not.toHaveBeenCalled();
    expect(delegate.update).not.toHaveBeenCalled();
    expect(delegate.delete).not.toHaveBeenCalled();
  }
}

describe('MU Contract transactional order applier', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockResolveCustomer.mockResolvedValue({
      status: 'MATCHED',
      orderNo: 'AB-12',
      derivedOrderName: 'AB',
      matchedBy: 'linked-order',
      matchedOrderNo: 'AB-12',
      orderId: 'finance-order-1',
      invoiceId: 'invoice-1',
      invNo: 'L26MH001',
      customerId: 'customer-1',
      customer: {
        id: 'customer-1',
        mark: 'AB',
        normalizedMark: 'ab',
        orderName: 'AB',
        orderNames: ['AB'],
        name: 'Alpha Buyer',
        displayName: 'Alpha Buyer Ltd',
        phone: '+224 600 00 00 00',
        city: 'Conakry',
        consignee: null,
        companyName: 'Alpha Buyer Ltd',
        companyAddress: 'Kaloum',
        credit: null,
      },
    });
  });

  it.each([
    ['manual match', manualRow(), 'MANUAL_ATTACHED'],
    ['missing order', null, 'SYNC_CREATED'],
  ])('%s preserves manual priority', async (_name, existingRow, expectedLinkMode) => {
    const tx = makeTx();
    tx.orderTracker.findFirst.mockResolvedValue(existingRow);

    const result = await apply(tx);

    expect(result).toEqual(expect.objectContaining({
      result: 'APPLIED',
      linkMode: expectedLinkMode,
    }));
    if (existingRow) {
      expect(tx.orderTracker.create).not.toHaveBeenCalled();
      expect(tx.orderTracker.update).not.toHaveBeenCalled();
    } else {
      expect(tx.orderTracker.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderNo: 'AB-12',
          normalizedOrderNo: 'ab-12',
          status: 'In progress',
          piStatus: false,
          remark: null,
          systemNote: null,
          confirmedAt: null,
          createdBy: 'service-admin',
        }),
      });
    }
    expectNoFinancialWrites(tx);
  });

  it('creates an admin-only unresolved row and preserves a nullable official amount', async () => {
    const tx = makeTx();
    mockResolveCustomer.mockResolvedValue({
      status: 'UNMATCHED',
      orderNo: 'UNKNOWN-01',
      code: 'EXCEL_ORDER_NOT_FOUND',
      message: '订单未匹配到客户',
    });

    const result = await apply(tx, makeEvent({ orderNo: 'UNKNOWN-01', amount: null, currency: null }));

    expect(result.result).toBe('APPLIED');
    expect(tx.orderTracker.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId: null,
        customerMark: null,
        customerName: null,
        financeOrderId: null,
        needsCustomerFix: true,
      }),
    });
    expect(tx.externalOrderSourceLink.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        officialAmount: null,
        currency: null,
        customerMatchStatus: 'UNMATCHED',
      }),
    });
  });

  it('copies a shared customer match only into a newly synchronized row', async () => {
    const tx = makeTx();

    await apply(tx);

    expect(tx.orderTracker.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId: 'customer-1',
        customerMark: 'AB',
        customerName: 'AB',
        customerPhone: '+224 600 00 00 00',
        customerCity: 'Conakry',
        financeOrderId: 'finance-order-1',
        needsCustomerFix: false,
      }),
    });
  });

  it('never rewrites unresolved customer or finance fields on a manually attached row', async () => {
    const tx = makeTx();
    tx.externalOrderSourceLink.findUnique.mockResolvedValue(sourceLink({
      linkMode: 'MANUAL_ATTACHED',
      orderTracker: manualRow({
        customerId: null,
        needsCustomerFix: true,
        financeOrderId: 'manual-finance-order',
        customerMark: 'MANUAL',
        customerName: 'Manual snapshot',
      }),
      customerMatchStatus: 'UNMATCHED',
    }));

    await apply(tx, makeEvent({ version: 3 }));

    expect(mockResolveCustomer).not.toHaveBeenCalled();
    expect(tx.orderTracker.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ customerId: expect.anything() }),
    }));
    expect(tx.externalOrderSourceLink.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ customerMatchStatus: 'UNMATCHED' }),
    }));
  });

  it('renames a manually attached row for the same PI without changing user-owned fields', async () => {
    const tx = makeTx();
    tx.externalOrderSourceLink.findUnique.mockResolvedValue(sourceLink({
      linkMode: 'MANUAL_ATTACHED',
      orderTracker: manualRow({
        orderNo: 'AB-11',
        normalizedOrderNo: 'ab-11',
      }),
      customerMatchStatus: 'MATCHED',
    }));

    const result = await apply(tx, makeEvent({
      orderNo: 'AB-12',
      previousOrderNo: 'AB-11',
      eventType: 'PI_ORDER_RENAMED',
      reason: 'ORDER_CHANGED',
    }));

    expect(result).toEqual(expect.objectContaining({
      result: 'APPLIED',
      orderTrackerId: 'manual-1',
      linkMode: 'MANUAL_ATTACHED',
    }));
    expect(tx.orderTracker.update).toHaveBeenCalledWith({
      where: { id: 'manual-1' },
      data: {
        orderNo: 'AB-12',
        normalizedOrderNo: 'ab-12',
        tokens: expect.any(String),
        updatedBy: 'service-admin',
      },
    });
    expect(tx.orderTracker.update.mock.calls[0][0].data).not.toEqual(expect.objectContaining({
      customerId: expect.anything(),
      status: expect.anything(),
      remark: expect.anything(),
      systemNote: expect.anything(),
      piStatus: expect.anything(),
      confirmedAt: expect.anything(),
    }));
  });

  it('records a conflict instead of renaming a manually attached row over another row', async () => {
    const tx = makeTx();
    tx.externalOrderSourceLink.findUnique.mockResolvedValue(sourceLink({
      linkMode: 'MANUAL_ATTACHED',
      orderTracker: manualRow({
        orderNo: 'AB-11',
        normalizedOrderNo: 'ab-11',
      }),
      customerMatchStatus: 'MATCHED',
    }));
    tx.orderTracker.findFirst.mockResolvedValue(manualRow({ id: 'manual-target' }));

    const result = await apply(tx, makeEvent({
      orderNo: 'AB-12',
      previousOrderNo: 'AB-11',
      eventType: 'PI_ORDER_RENAMED',
      reason: 'ORDER_CHANGED',
    }));

    expect(result).toEqual(expect.objectContaining({
      result: 'BUSINESS_CONFLICT',
      orderTrackerId: 'manual-1',
      linkMode: 'MANUAL_ATTACHED',
      conflictType: 'ORDER_NO_COLLISION',
    }));
    expect(tx.orderTracker.update).not.toHaveBeenCalled();
    expect(tx.integrationSyncConflict.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        type: 'ORDER_NO_COLLISION',
        targetOrderTrackerIds: ['manual-1', 'manual-target'],
      }),
    }));
  });

  it('renames the same PI row while preserving all user-owned fields', async () => {
    const tx = makeTx();
    const existing = sourceLink({ customerMatchStatus: 'MATCHED' });
    tx.externalOrderSourceLink.findUnique.mockResolvedValue(existing);

    const result = await apply(tx, makeEvent({
      orderNo: 'AB-12',
      previousOrderNo: 'AB-11',
      eventType: 'PI_ORDER_RENAMED',
      reason: 'ORDER_CHANGED',
    }));

    expect(result.result).toBe('APPLIED');
    expect(tx.orderTracker.update).toHaveBeenCalledWith({
      where: { id: 'sync-old' },
      data: {
        orderNo: 'AB-12',
        normalizedOrderNo: 'ab-12',
        tokens: expect.any(String),
        updatedBy: 'service-admin',
      },
    });
    expect(tx.orderTracker.update.mock.calls[0][0].data).not.toEqual(expect.objectContaining({
      status: expect.anything(),
      remark: expect.anything(),
      systemNote: expect.anything(),
      piStatus: expect.anything(),
    }));
  });

  it('archives an untouched sync row and transfers its link to a colliding manual row', async () => {
    const tx = makeTx();
    tx.externalOrderSourceLink.findUnique.mockResolvedValue(sourceLink());
    tx.orderTracker.findFirst.mockResolvedValue(manualRow({ id: 'manual-target' }));

    const result = await apply(tx, makeEvent({
      orderNo: 'AB-12',
      previousOrderNo: 'AB-11',
      eventType: 'PI_ORDER_RENAMED',
      reason: 'ORDER_CHANGED',
    }));

    expect(result).toEqual(expect.objectContaining({
      result: 'APPLIED',
      orderTrackerId: 'manual-target',
      linkMode: 'MANUAL_ATTACHED',
    }));
    expect(tx.orderTracker.update).toHaveBeenCalledWith({
      where: { id: 'sync-old' },
      data: expect.objectContaining({
        archivedAt: expect.any(Date),
        archiveReason: expect.stringContaining('MU_CONTRACT'),
        normalizedOrderNo: expect.stringMatching(/^__archived__:mu_contract:/),
        updatedBy: 'service-admin',
      }),
    });
    expect(tx.externalOrderSourceLink.update).toHaveBeenCalledWith({
      where: { id: 'link-1' },
      data: expect.objectContaining({
        orderTrackerId: 'manual-target',
        linkMode: 'MANUAL_ATTACHED',
      }),
    });
  });

  it('does not attach a new PI to an archived hidden row with the old business key', async () => {
    const tx = makeTx();
    tx.orderTracker.findUnique.mockResolvedValue(manualRow({
      id: 'archived-hidden',
      archivedAt: new Date('2026-07-17T00:00:00.000Z'),
    }));
    tx.orderTracker.findFirst.mockResolvedValue(null);

    const result = await apply(tx);

    expect(result).toEqual(expect.objectContaining({
      orderTrackerId: 'sync-created',
      linkMode: 'SYNC_CREATED',
    }));
    expect(tx.orderTracker.create).toHaveBeenCalled();
    expect(tx.externalOrderSourceLink.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ orderTrackerId: 'sync-created' }),
    });
  });

  it('records a conflict instead of replacing a human-edited sync row', async () => {
    const tx = makeTx();
    tx.externalOrderSourceLink.findUnique.mockResolvedValue(sourceLink({
      humanEditedAt: new Date('2026-07-17T00:00:00.000Z'),
    }));
    tx.orderTracker.findFirst.mockResolvedValue(manualRow({ id: 'manual-target' }));

    const result = await apply(tx, makeEvent({
      orderNo: 'AB-12',
      previousOrderNo: 'AB-11',
      eventType: 'PI_ORDER_RENAMED',
      reason: 'ORDER_CHANGED',
    }));

    expect(result).toEqual(expect.objectContaining({
      result: 'BUSINESS_CONFLICT',
      conflictType: 'HUMAN_EDITED_RENAME_COLLISION',
    }));
    expect(tx.integrationSyncConflict.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ type: 'HUMAN_EDITED_RENAME_COLLISION' }),
    }));
    expect(tx.orderTracker.update).not.toHaveBeenCalled();
  });

  it('does not attach a second PI source to the same Orders row', async () => {
    const tx = makeTx();
    tx.orderTracker.findFirst.mockResolvedValue(manualRow());
    tx.externalOrderSourceLink.findFirst.mockResolvedValue({
      id: 'other-link',
      externalId: 'pi-2',
      orderTrackerId: 'manual-1',
      active: true,
      officialAmount: '10000.00',
    });

    const result = await apply(tx);

    expect(result).toEqual(expect.objectContaining({
      result: 'BUSINESS_CONFLICT',
      orderTrackerId: null,
      conflictType: 'SOURCE_LINK_COLLISION',
    }));
    expect(tx.externalOrderSourceLink.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ orderTrackerId: null }),
    });
    expect(tx.orderTracker.update).not.toHaveBeenCalled();
  });

  it('replaces an inactive foreign PI source on the same ORDER NO', async () => {
    const tx = makeTx();
    tx.orderTracker.findFirst.mockResolvedValue(manualRow());
    tx.externalOrderSourceLink.findFirst.mockResolvedValue({
      id: 'inactive-link',
      externalId: 'pi-deleted',
      orderTrackerId: 'manual-1',
      active: false,
      officialAmount: '10000.00',
    });

    const result = await apply(tx, makeEvent({
      piId: 'pi-recreated',
      amount: '12500.00',
    }));

    expect(result).toEqual(expect.objectContaining({
      result: 'APPLIED',
      orderTrackerId: 'manual-1',
      linkMode: 'MANUAL_ATTACHED',
      conflictType: null,
      takeover: expect.objectContaining({
        oldSourcePiId: 'pi-deleted',
        newSourcePiId: 'pi-recreated',
        orderTrackerId: 'manual-1',
      }),
    }));
    expect(tx.externalOrderSourceLink.update).toHaveBeenCalledWith({
      where: { id: 'inactive-link' },
      data: { orderTrackerId: null },
    });
    expect(tx.externalOrderSourceLink.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        externalId: 'pi-recreated',
        orderTrackerId: 'manual-1',
        officialAmount: '12500.00',
      }),
    });
  });

  it('does not let the displaced PI reclaim the Orders row after reactivation', async () => {
    const tx = makeTx();
    tx.externalOrderSourceLink.findUnique.mockResolvedValue(sourceLink({
      externalId: 'pi-deleted',
      active: false,
      orderTrackerId: null,
      orderTracker: null,
    }));
    tx.orderTracker.findFirst.mockResolvedValue(manualRow());
    tx.externalOrderSourceLink.findFirst.mockResolvedValue({
      id: 'replacement-link',
      externalId: 'pi-recreated',
      orderTrackerId: 'manual-1',
      active: true,
      officialAmount: '12500.00',
    });

    const result = await apply(tx, makeEvent({
      piId: 'pi-deleted',
      version: 3,
      amount: '10000.00',
    }));

    expect(result).toEqual(expect.objectContaining({
      result: 'BUSINESS_CONFLICT',
      orderTrackerId: null,
      conflictType: 'SOURCE_LINK_COLLISION',
    }));
    expect(tx.externalOrderSourceLink.update).toHaveBeenCalledWith({
      where: { id: 'link-1' },
      data: expect.objectContaining({
        active: true,
        orderTrackerId: null,
      }),
    });
    expect(tx.externalOrderSourceLink.update).not.toHaveBeenCalledWith({
      where: { id: 'replacement-link' },
      data: { orderTrackerId: null },
    });
  });

  it('ignores a source version lower than the durable PI link version', async () => {
    const tx = makeTx();
    tx.externalOrderSourceLink.findUnique.mockResolvedValue(sourceLink({ sourceVersion: 3 }));

    const result = await apply(tx, makeEvent({ version: 2 }));

    expect(result).toEqual({
      result: 'IGNORED_STALE',
      orderTrackerId: 'sync-old',
      linkMode: 'SYNC_CREATED',
      conflictType: null,
    });
    expect(tx.orderTracker.update).not.toHaveBeenCalled();
    expect(tx.externalOrderSourceLink.update).not.toHaveBeenCalled();
    expect(tx.integrationSyncConflict.upsert).not.toHaveBeenCalled();
  });

  it('deactivates only the source link and keeps the Orders row', async () => {
    const tx = makeTx();
    tx.externalOrderSourceLink.findUnique.mockResolvedValue(sourceLink());

    const result = await apply(tx, makeEvent({
      active: false,
      eventType: 'PI_SOURCE_DEACTIVATED',
      reason: 'PI_DELETED',
    }));

    expect(result.result).toBe('APPLIED');
    expect(tx.externalOrderSourceLink.update).toHaveBeenCalledWith({
      where: { id: 'link-1' },
      data: expect.objectContaining({
        active: false,
        sourceDeletedAt: new Date('2026-07-18T08:00:00.000Z'),
      }),
    });
    expect(tx.orderTracker.update).not.toHaveBeenCalled();
  });

  it('retains non-USD metadata but returns an explicit business conflict', async () => {
    const tx = makeTx();
    tx.orderTracker.findFirst.mockResolvedValue(manualRow());

    const result = await apply(tx, makeEvent({ currency: 'EUR', amount: '900.00' }));

    expect(result).toEqual(expect.objectContaining({
      result: 'BUSINESS_CONFLICT',
      conflictType: 'UNSUPPORTED_CURRENCY',
    }));
    expect(tx.externalOrderSourceLink.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ currency: 'EUR', officialAmount: '900.00' }),
    });
    expect(tx.integrationSyncConflict.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ type: 'UNSUPPORTED_CURRENCY' }),
    }));
    expectNoFinancialWrites(tx);
  });

  it('keeps a customer-match conflict visible and retryable', async () => {
    const tx = makeTx();
    mockResolveCustomer.mockResolvedValue({
      status: 'CONFLICT',
      orderNo: 'AB-12',
      code: 'EXCEL_ORDER_CONFLICT',
      message: '订单匹配到多个客户',
      detail: { customerIds: ['customer-1', 'customer-2'] },
    });

    const result = await apply(tx);

    expect(result).toEqual(expect.objectContaining({
      result: 'BUSINESS_CONFLICT',
      conflictType: 'CUSTOMER_MATCH_CONFLICT',
    }));
    expect(tx.orderTracker.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ needsCustomerFix: true, customerId: null }),
    });
    expect(tx.externalOrderSourceLink.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ customerMatchStatus: 'CONFLICT' }),
    });
  });
});
