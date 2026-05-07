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
          companyName: 'Alpha Trading SARL',
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
            customer: {
              companyName: 'Alpha Trading SARL',
            },
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
            customer: {
              companyName: 'Alpha Trading SARL',
            },
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
    expect(result.data.preview?.clientName).toBe('Alpha Trading SARL "Big Alpha"');
  });

  it('prefers the customer profile name over the order row customerName for signed receipts', async () => {
    mockLookupInvoiceOrderContext.mockResolvedValueOnce({
      data: {
        derivedOrderName: 'PIKIN',
        inferredCustomer: null,
        exactMatches: [
          {
            id: 'order-pikin',
            orderNo: 'PIKIN-20',
            orderBalance: 8458,
            customerId: 'customer-pikin',
            customerMark: 'PIKIN',
            customerName: 'PIKIN',
            customerPhone: '620000020',
            customerCity: 'Conakry',
            needsCustomerFix: false,
            customer: {
              companyName: null,
              name: 'Mamadou Dian Diallo',
            },
            invoice: { id: 'inv-pikin', invNo: 'INV-PIKIN', createdAt: new Date('2026-05-07T00:00:00Z') },
          },
        ],
      },
    });

    const result = await lookupReceiptGeneratorOrderContext(makeUser(), 'PIKIN-20', 1);

    expect(result.data.customer).toEqual(expect.objectContaining({
      name: 'Mamadou Dian Diallo',
      companyName: null,
      mark: 'PIKIN',
    }));
    expect(result.data.preview?.clientName).toBe('Mamadou Dian Diallo "PIKIN"');
  });

  it('returns the full matched composite ORDER NO for generator context', async () => {
    mockLookupInvoiceOrderContext.mockResolvedValueOnce({
      data: {
        derivedOrderName: 'AB',
        inferredCustomer: null,
        exactMatches: [
          {
            id: 'order-composite',
            orderNo: 'AB-13B/AB-12B',
            orderBalance: 10000,
            customerId: 'customer-ab',
            customerMark: 'AB',
            customerName: 'Abdoulaye Barry',
            customerPhone: '+224 664 51 79 52',
            customerCity: 'Conakry',
            needsCustomerFix: false,
            customer: {
              companyName: 'AB Trading',
            },
            invoice: { id: 'inv-ab', invNo: 'L25MH060992C', createdAt: new Date('2026-05-07T00:00:00Z') },
          },
        ],
      },
    });

    const result = await lookupReceiptGeneratorOrderContext(makeUser(), 'AB-13B', 3200);

    expect(result.data.orderNo).toBe('AB-13B/AB-12B');
    expect(result.data.preview?.orderNo).toBe('AB-13B/AB-12B');
  });

  it('loads a pending generator session by sessionId', async () => {
    mockDb.receiptGeneratorSession.findUnique.mockResolvedValueOnce({
      id: 'session-1',
      receiptId: 'receipt-1',
      receiptNo: '0001000',
      orderNo: 'Big Alpha-07',
      invNo: 'L25MH060523',
      customerMark: 'Big Alpha',
      layoutSnapshot: { customerCompanyName: 'Alpha Trading SARL', paymentMode: 'Transfer' },
      customerName: 'Alpha Oumar Diallo',
      clientTel: '628 38 63 63',
      usd: 2500,
      balanceBefore: 34660,
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
    expect(result.data.layout.clientName).toBe('Alpha Trading SARL "Big Alpha"');
    expect(result.data.layout.paymentMode).toBe('Transfer');
  });

  it('resolves a pending generator session by receiptId', async () => {
    mockDb.receiptGeneratorSession.findFirst.mockResolvedValueOnce({
      id: 'session-1',
      receiptId: 'receipt-1',
      receiptNo: '0001000',
      orderNo: 'Big Alpha-07',
      invNo: 'L25MH060523',
      customerMark: 'Big Alpha',
      layoutSnapshot: { customerCompanyName: 'Alpha Trading SARL' },
      customerName: 'Alpha Oumar Diallo',
      clientTel: '628 38 63 63',
      usd: 2500,
      balanceBefore: 34660,
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
    expect(result.data.layout.clientName).toBe('Alpha Trading SARL "Big Alpha"');
  });
});
