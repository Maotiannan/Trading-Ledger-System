import { ReceiptGeneratorSessionStatus, ReceiptStatus, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { canAccessOwnedResourceAsync } from '@/lib/ownership';
import { recordAuditEvent } from '@/lib/audit';
import { lookupInvoiceOrderContext } from '@/lib/invoice-read-service';
import { allocateNextReceiptNo } from '@/lib/receipt-number';
import { saveReceiptGeneratorArtifact } from '@/lib/receipt-generator-image';
import {
  createReceiptGeneratorSession,
  finalizeReceiptGeneratorSession,
} from '@/lib/receipt-generator-service';

jest.mock('@/lib/db', () => ({
  db: {
    receipt: {
      create: jest.fn(),
      update: jest.fn(),
    },
    receiptGeneratorSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/ownership', () => ({
  canAccessOwnedResourceAsync: jest.fn(),
}));

jest.mock('@/lib/audit', () => ({
  recordAuditEvent: jest.fn(),
}));

jest.mock('@/lib/invoice-read-service', () => ({
  lookupInvoiceOrderContext: jest.fn(),
}));

jest.mock('@/lib/receipt-number', () => ({
  allocateNextReceiptNo: jest.fn(),
}));

jest.mock('@/lib/receipt-generator-image', () => ({
  saveReceiptGeneratorArtifact: jest.fn(),
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
  receipt: { create: jest.Mock; update: jest.Mock };
  receiptGeneratorSession: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  $transaction: jest.Mock;
};
const mockLookupInvoiceOrderContext = lookupInvoiceOrderContext as jest.Mock;
const mockAllocateNextReceiptNo = allocateNextReceiptNo as jest.Mock;
const mockSaveReceiptGeneratorArtifact = saveReceiptGeneratorArtifact as jest.Mock;
const mockCanAccessOwnedResourceAsync = canAccessOwnedResourceAsync as jest.Mock;
const mockRecordAuditEvent = recordAuditEvent as jest.Mock;

describe('receipt-generator-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(mockDb));
    mockCanAccessOwnedResourceAsync.mockResolvedValue(true);
    mockAllocateNextReceiptNo.mockResolvedValue('0001000');
    mockLookupInvoiceOrderContext.mockResolvedValue({
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
            id: 'order-1',
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
            invoice: { id: 'inv-1', invNo: 'L25MH060523', createdAt: new Date('2026-04-27T00:00:00Z') },
          },
        ],
      },
    });
  });

  it('creates a signing-pending receipt and generator session before signing', async () => {
    mockDb.receipt.create.mockResolvedValueOnce({
      id: 'receipt-1',
      receiptNo: '0001000',
      status: ReceiptStatus.SIGNING_PENDING,
    });
    mockDb.receiptGeneratorSession.create.mockResolvedValueOnce({
      id: 'session-1',
      receiptId: 'receipt-1',
      receiptNo: '0001000',
      status: ReceiptGeneratorSessionStatus.PENDING,
    });

    const result = await createReceiptGeneratorSession(makeUser(), {
      orderNo: 'Big Alpha-07',
      usdAmount: 2500,
    });

    expect(mockDb.receipt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        receiptNo: '0001000',
        status: ReceiptStatus.SIGNING_PENDING,
        orderId: 'order-1',
        invNo: 'L25MH060523',
        payer: 'Alpha Trading SARL "Big Alpha"',
      }),
    }));
    expect(mockDb.receiptGeneratorSession.create).toHaveBeenCalled();
    expect(result.data.signingPath).toBe('/receipt-generator/session-1');
    expect(mockRecordAuditEvent).toHaveBeenCalled();
  });

  it('finalizes a signing session into a normal receipt with generated image', async () => {
    mockDb.receiptGeneratorSession.findUnique.mockResolvedValueOnce({
      id: 'session-1',
      receiptId: 'receipt-1',
      receiptNo: '0001000',
      layoutSnapshot: { receiptNo: '0001000' },
      status: ReceiptGeneratorSessionStatus.PENDING,
      receipt: {
        id: 'receipt-1',
        createdBy: 'admin-1',
        status: ReceiptStatus.SIGNING_PENDING,
        receiptNo: '0001000',
      },
    });
    mockSaveReceiptGeneratorArtifact
      .mockResolvedValueOnce({ path: '/upload/images/receipts/generated/2026/04/0001000-receipt.png', name: '0001000-receipt.png' })
      .mockResolvedValueOnce({ path: '/upload/images/receipts/generated/2026/04/signatures/0001000-receiver-signature.png', name: '0001000-receiver-signature.png' })
      .mockResolvedValueOnce({ path: '/upload/images/receipts/generated/2026/04/signatures/0001000-payer-signature.png', name: '0001000-payer-signature.png' });
    mockDb.receiptGeneratorSession.update.mockResolvedValueOnce({
      id: 'session-1',
      finalImageUrl: '/upload/images/receipts/generated/2026/04/0001000-receipt.png',
      finalImageName: '0001000-receipt.png',
      receipt: {
        id: 'receipt-1',
        receiptNo: '0001000',
        status: ReceiptStatus.SR_Received,
        imageUrl: '/upload/images/receipts/generated/2026/04/0001000-receipt.png',
        imageName: '0001000-receipt.png',
      },
    });

    const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const makeMockFile = (name: string) => ({
      name,
      type: 'image/png',
      arrayBuffer: async () => pngBytes.buffer,
    }) as unknown as File;
    const receiptImage = makeMockFile('receipt.png');
    const receiverSignature = makeMockFile('receiver.png');
    const payerSignature = makeMockFile('payer.png');

    const result = await finalizeReceiptGeneratorSession(makeUser(), {
      sessionId: 'session-1',
      receiptImage,
      receiverSignature,
      payerSignature,
      layoutSnapshot: { receiptNo: '0001000', orderNo: 'Big Alpha-07' },
    });

    expect(mockDb.receipt.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'receipt-1' },
      data: expect.objectContaining({
        status: ReceiptStatus.SR_Received,
      }),
    }));
    expect(mockDb.receiptGeneratorSession.update).toHaveBeenCalled();
    expect(result.data.receiptStatus).toBe('SR_Received');
  });
});
