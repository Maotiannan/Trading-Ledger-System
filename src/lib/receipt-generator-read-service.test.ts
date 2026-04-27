import { ReceiptGeneratorSessionStatus, ReceiptStatus, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { canAccessOwnedResourceAsync } from '@/lib/ownership';
import { lookupInvoiceOrderContext } from '@/lib/invoice-read-service';
import {
  getOpenReceiptGeneratorSessionByReceipt,
  getReceiptGeneratorSession,
  lookupReceiptGeneratorOrderContext,
} from '@/lib/receipt-generator-read-service';

jest.mock('@/lib/db', () => ({
  db: {
    receiptGeneratorSession: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('@/lib/ownership', () => ({
  canAccessOwnedResourceAsync: jest.fn(),
}));

jest.mock('@/lib/invoice-read-service', () => ({
  lookupInvoiceOrderContext: jest.fn(),
}));

function makeUser(role: UserRole = UserRole.ADMIN) {
  return {
    id: 'admin-1',
    email: 'admin@example.com',
    name: 'Admin',
    role,
    level: 1,
    parentId: null,
    createdById: null,
  };
}

const mockDb = db as unknown as {
  receiptGeneratorSession: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
  };
};
const mockCanAccessOwnedResourceAsync = canAccessOwnedResourceAsync as jest.Mock;
const mockLookupInvoiceOrderContext = lookupInvoiceOrderContext as jest.Mock;

describe('receipt-generator-read-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCanAccessOwnedResourceAsync.mockResolvedValue(true);
  });

  it('returns order context with latest invoice suggestion and unique customer', async () => {
    mockLookupInvoiceOrderContext.mockResolvedValueOnce({
      data: {
        derivedOrderName: 'Big Alpha',
        inferredCustomer: {
          id: 'customer-1',
          mark: 'Big Alpha',
          orderName: 'Big Alpha',
          name: 'Alpha Oumar Diallo',
          phone: '628 38 63 63',
          city: 'Conakry',
        },
        exactMatches: [
          {
            id: 'order-2',
            orderNo: 'Big Alpha-07',
            orderBalance: 34660,
            customerId: 'customer-1',
            customerMark: 'Big Alpha',
            customerName: 'Alpha Oumar Diallo',
            customerPhone: '628 38 63 63',
            customerCity: 'Conakry',
            needsCustomerFix: false,
            invoice: { id: 'inv-2', invNo: 'L25MH060523', createdAt: new Date('2026-04-27T00:00:00Z') },
          },
          {
            id: 'order-1',
            orderNo: 'Big Alpha-07',
            orderBalance: 40000,
            customerId: 'customer-1',
            customerMark: 'Big Alpha',
            customerName: 'Alpha Oumar Diallo',
            customerPhone: '628 38 63 63',
            customerCity: 'Conakry',
            needsCustomerFix: false,
            invoice: { id: 'inv-1', invNo: 'L25MH050000', createdAt: new Date('2026-04-20T00:00:00Z') },
          },
        ],
      },
    });

    const result = await lookupReceiptGeneratorOrderContext(makeUser(), 'Big Alpha-07', 2500);

    expect(result.data.invoiceSuggestion).toEqual({
      invNo: 'L25MH060523',
      conflict: true,
      count: 2,
    });
    expect(result.data.customer).toEqual(expect.objectContaining({
      id: 'customer-1',
      mark: 'Big Alpha',
      name: 'Alpha Oumar Diallo',
    }));
    expect(result.data.balanceBefore).toBe(34660);
    expect(result.data.preview?.balanceAfter).toBe(32160);
  });

  it('loads a pending generator session by sessionId', async () => {
    mockDb.receiptGeneratorSession.findUnique.mockResolvedValueOnce({
      id: 'session-1',
      receiptId: 'receipt-1',
      receiptNo: '0001000',
      orderNo: 'Big Alpha-07',
      invNo: 'L25MH060523',
      customerMark: 'Big Alpha',
      customerName: 'Alpha Oumar Diallo',
      clientTel: '628 38 63 63',
      usd: 2500,
      balanceBefore: 34660,
      layoutSnapshot: null,
      receiverSignatureUrl: null,
      payerSignatureUrl: null,
      finalImageUrl: null,
      finalImageName: null,
      status: ReceiptGeneratorSessionStatus.PENDING,
      createdBy: 'admin-1',
      createdAt: new Date('2026-04-27T00:00:00Z'),
      updatedAt: new Date('2026-04-27T00:00:00Z'),
      receipt: {
        id: 'receipt-1',
        createdBy: 'admin-1',
        status: ReceiptStatus.SIGNING_PENDING,
        imageUrl: null,
        imageName: null,
      },
    });

    const result = await getReceiptGeneratorSession(makeUser(), 'session-1');

    expect(result.data.receiptNo).toBe('0001000');
    expect(result.data.canFinalize).toBe(true);
    expect(result.data.receiptStatus).toBe('SIGNING_PENDING');
  });

  it('resolves a pending generator session by receiptId', async () => {
    mockDb.receiptGeneratorSession.findFirst.mockResolvedValueOnce({
      id: 'session-1',
      receiptId: 'receipt-1',
      receiptNo: '0001000',
      orderNo: 'Big Alpha-07',
      invNo: 'L25MH060523',
      customerMark: 'Big Alpha',
      customerName: 'Alpha Oumar Diallo',
      clientTel: '628 38 63 63',
      usd: 2500,
      balanceBefore: 34660,
      layoutSnapshot: null,
      receiverSignatureUrl: null,
      payerSignatureUrl: null,
      finalImageUrl: null,
      finalImageName: null,
      status: ReceiptGeneratorSessionStatus.PENDING,
      createdBy: 'admin-1',
      createdAt: new Date('2026-04-27T00:00:00Z'),
      updatedAt: new Date('2026-04-27T00:00:00Z'),
      receipt: {
        createdBy: 'admin-1',
      },
    });

    const result = await getOpenReceiptGeneratorSessionByReceipt(makeUser(), 'receipt-1');
    expect(result.data.id).toBe('session-1');
    expect(result.data.receiptNo).toBe('0001000');
  });
});
