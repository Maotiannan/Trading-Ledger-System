import { resolveReceiptEditBinding } from '@/lib/receipt-edit-binding';
import { findOrderIdByNoOrAliasWithExecutor, syncOrderAliases } from '@/lib/order-alias-db';
import { ensureSystemPoolInvoice } from '@/lib/matching';

jest.mock('@/lib/order-alias-db', () => ({
  findOrderIdByNoOrAliasWithExecutor: jest.fn(),
  syncOrderAliases: jest.fn(),
}));

jest.mock('@/lib/matching', () => ({
  ensureDepositPoolInvoice: jest.fn(),
  ensureSystemPoolInvoice: jest.fn(),
}));

const mockFindOrderIdByNoOrAliasWithExecutor = findOrderIdByNoOrAliasWithExecutor as jest.Mock;
const mockSyncOrderAliases = syncOrderAliases as jest.Mock;
const mockEnsureSystemPoolInvoice = ensureSystemPoolInvoice as jest.Mock;

function makeClient() {
  return {
    order: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    invoice: {
      findFirst: jest.fn(),
    },
  };
}

function makeParams(overrides: Partial<Parameters<typeof resolveReceiptEditBinding>[1]> = {}) {
  return {
    currentUserId: 'admin-1',
    ownerIds: ['admin-1', 'sales-1'],
    orderNo: 'PIKIN-20',
    invNo: 'OCR-INV',
    isDeposit: false,
    customerId: 'customer-1',
    customerMark: 'PIKIN',
    customerName: 'PIKIN',
    customerPhone: '620000000',
    customerCity: 'Conakry',
    needsCustomerFix: false,
    ...overrides,
  };
}

describe('resolveReceiptEditBinding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('binds to a visible existing order and uses that order invoice number', async () => {
    const client = makeClient();
    mockFindOrderIdByNoOrAliasWithExecutor.mockResolvedValueOnce('order-pikin-20');
    client.order.findUnique.mockResolvedValueOnce({
      id: 'order-pikin-20',
      orderNo: 'PIKIN-20',
      invoice: { invNo: 'L25MH-PIKIN' },
    });

    const result = await resolveReceiptEditBinding(client as never, makeParams());

    expect(result).toEqual({
      orderId: 'order-pikin-20',
      orderNo: 'PIKIN-20',
      invNo: 'L25MH-PIKIN',
    });
    expect(client.order.create).not.toHaveBeenCalled();
  });

  it('creates a zero-amount order under the edited invoice when the order is not registered yet', async () => {
    const client = makeClient();
    mockFindOrderIdByNoOrAliasWithExecutor.mockResolvedValueOnce(null);
    client.invoice.findFirst.mockResolvedValueOnce({ id: 'invoice-target', invNo: 'L25MH-TARGET' });
    client.order.create.mockResolvedValueOnce({ id: 'order-new', orderNo: 'AB-13B' });

    const result = await resolveReceiptEditBinding(client as never, makeParams({
      orderNo: 'AB-13B',
      invNo: 'L25MH-TARGET',
      customerMark: 'AB',
      customerName: 'AB',
    }));

    expect(client.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        invoiceId: 'invoice-target',
        orderNo: 'AB-13B',
        amount: 0,
        orderBalance: 0,
        customerMark: 'AB',
      }),
    }));
    expect(mockSyncOrderAliases).toHaveBeenCalledWith(client, 'order-new', 'AB-13B');
    expect(result).toEqual({
      orderId: 'order-new',
      orderNo: 'AB-13B',
      invNo: 'L25MH-TARGET',
    });
  });

  it('moves a visible pool order to the edited invoice when an admin supplies a real invoice number', async () => {
    const client = makeClient();
    mockFindOrderIdByNoOrAliasWithExecutor.mockResolvedValueOnce('order-pool');
    client.order.findUnique.mockResolvedValueOnce({
      id: 'order-pool',
      orderNo: 'AB-13B',
      invoiceId: 'invoice-unassociated',
      invoice: { id: 'invoice-unassociated', invNo: 'Un_Associated' },
    });
    client.invoice.findFirst.mockResolvedValueOnce({ id: 'invoice-target', invNo: 'L25MH-TARGET' });
    client.order.update.mockResolvedValueOnce({
      id: 'order-pool',
      orderNo: 'AB-13B',
      invoiceId: 'invoice-target',
    });

    const result = await resolveReceiptEditBinding(client as never, makeParams({
      orderNo: 'AB-13B',
      invNo: 'L25MH-TARGET',
    }));

    expect(client.order.update).toHaveBeenCalledWith({
      where: { id: 'order-pool' },
      data: { invoiceId: 'invoice-target' },
    });
    expect(result).toEqual({
      orderId: 'order-pool',
      orderNo: 'AB-13B',
      invNo: 'L25MH-TARGET',
    });
  });

  it('falls back to Un_Associated and clears invoice number when neither order nor invoice matches', async () => {
    const client = makeClient();
    mockFindOrderIdByNoOrAliasWithExecutor.mockResolvedValueOnce(null);
    client.invoice.findFirst.mockResolvedValueOnce(null);
    mockEnsureSystemPoolInvoice.mockResolvedValueOnce('invoice-unassociated');
    client.order.create.mockResolvedValueOnce({ id: 'order-unassociated', orderNo: 'AB-13B' });

    const result = await resolveReceiptEditBinding(client as never, makeParams({
      orderNo: 'AB-13B',
      invNo: 'OCR-INV',
    }));

    expect(client.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        invoiceId: 'invoice-unassociated',
        orderNo: 'AB-13B',
      }),
    }));
    expect(result).toEqual({
      orderId: 'order-unassociated',
      orderNo: 'AB-13B',
      invNo: null,
    });
  });
});
