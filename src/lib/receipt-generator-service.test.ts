import {
  ReceiptGeneratorSessionStatus,
  ReceiptStatus,
  UploadedAssetAttachmentType,
  UploadedAssetCategory,
  UploadedAssetStatus,
  UserRole,
} from '@prisma/client';
import { rm } from 'fs/promises';
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
    uploadedAsset: {
      createMany: jest.fn(),
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

jest.mock('fs/promises', () => ({
  rm: jest.fn(),
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
  uploadedAsset: { createMany: jest.Mock };
  $transaction: jest.Mock;
};
const mockLookupInvoiceOrderContext = lookupInvoiceOrderContext as jest.Mock;
const mockAllocateNextReceiptNo = allocateNextReceiptNo as jest.Mock;
const mockSaveReceiptGeneratorArtifact = saveReceiptGeneratorArtifact as jest.Mock;
const mockCanAccessOwnedResourceAsync = canAccessOwnedResourceAsync as jest.Mock;
const mockRecordAuditEvent = recordAuditEvent as jest.Mock;
const mockRm = rm as jest.MockedFunction<typeof rm>;

describe('receipt-generator-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(mockDb));
    mockCanAccessOwnedResourceAsync.mockResolvedValue(true);
    mockAllocateNextReceiptNo.mockResolvedValue('0001000');
    mockRm.mockResolvedValue(undefined);
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
      paymentMode: 'Transfer',
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
    expect(mockDb.receiptGeneratorSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        layoutSnapshot: expect.objectContaining({
          paymentMode: 'Transfer',
        }),
      }),
    }));
    expect(result.data.signingPath).toBe('/receipt-generator/session-1');
    expect(mockRecordAuditEvent).toHaveBeenCalled();
  });

  it('creates signing receipt with the full matched composite ORDER NO', async () => {
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
    mockDb.receipt.create.mockResolvedValueOnce({
      id: 'receipt-composite',
      receiptNo: '0001000',
      status: ReceiptStatus.SIGNING_PENDING,
    });
    mockDb.receiptGeneratorSession.create.mockResolvedValueOnce({
      id: 'session-composite',
      receiptId: 'receipt-composite',
      receiptNo: '0001000',
      status: ReceiptGeneratorSessionStatus.PENDING,
    });

    await createReceiptGeneratorSession(makeUser(), {
      orderNo: 'AB-13B',
      usdAmount: 3200,
      paymentMode: 'Cash',
    });

    expect(mockDb.receipt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        orderId: 'order-composite',
        orderNo: 'AB-13B/AB-12B',
        invNo: 'L25MH060992C',
      }),
    }));
    expect(mockDb.receiptGeneratorSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        orderNo: 'AB-13B/AB-12B',
        layoutSnapshot: expect.objectContaining({
          orderNo: 'AB-13B/AB-12B',
        }),
      }),
    }));
  });

  it('finalizes a signing session into a normal receipt with generated image', async () => {
    mockDb.receiptGeneratorSession.findUnique.mockResolvedValueOnce({
      id: 'session-1',
      createdBy: 'admin-1',
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
      .mockResolvedValueOnce({
        path: '/upload/images/receipts/generated/2026/04/0001000-receipt.png',
        name: '0001000-receipt.png',
      })
      .mockResolvedValueOnce({
        path: '/upload/images/receipts/generated/2026/04/signatures/0001000-receiver-signature.png',
        name: '0001000-receiver-signature.png',
      })
      .mockResolvedValueOnce({
        path: '/upload/images/receipts/generated/2026/04/signatures/0001000-payer-signature.png',
        name: '0001000-payer-signature.png',
      });
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

  it('registers generator signatures and final image as attached assets on finalize', async () => {
    mockDb.receiptGeneratorSession.findUnique.mockResolvedValueOnce({
      id: 'session-1',
      createdBy: 'admin-1',
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
      .mockResolvedValueOnce({
        path: '/upload/images/receipts/generated/2026/04/0001000-receipt.png',
        name: '0001000-receipt.png',
      })
      .mockResolvedValueOnce({
        path: '/upload/images/receipts/generated/2026/04/signatures/0001000-receiver-signature.png',
        name: '0001000-receiver-signature.png',
      })
      .mockResolvedValueOnce({
        path: '/upload/images/receipts/generated/2026/04/signatures/0001000-payer-signature.png',
        name: '0001000-payer-signature.png',
      });
    mockDb.uploadedAsset.createMany.mockResolvedValueOnce({ count: 3 });
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

    await finalizeReceiptGeneratorSession(makeUser(), {
      sessionId: 'session-1',
      receiptImage: makeMockFile('receipt.png'),
      receiverSignature: makeMockFile('receiver.png'),
      payerSignature: makeMockFile('payer.png'),
      layoutSnapshot: { receiptNo: '0001000', orderNo: 'Big Alpha-07' },
    });

    expect(mockDb.uploadedAsset.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({
          path: '/upload/images/receipts/generated/2026/04/signatures/0001000-receiver-signature.png',
          name: '0001000-receiver-signature.png',
          category: UploadedAssetCategory.RECEIPT_GENERATOR_SIGNATURE,
          mimeType: 'image/png',
          sizeBytes: pngBytes.byteLength,
          createdBy: 'admin-1',
          status: UploadedAssetStatus.ATTACHED,
          attachedType: UploadedAssetAttachmentType.RECEIPT_GENERATOR_SESSION,
          attachedId: 'session-1',
        }),
        expect.objectContaining({
          path: '/upload/images/receipts/generated/2026/04/signatures/0001000-payer-signature.png',
          name: '0001000-payer-signature.png',
          category: UploadedAssetCategory.RECEIPT_GENERATOR_SIGNATURE,
          mimeType: 'image/png',
          sizeBytes: pngBytes.byteLength,
          createdBy: 'admin-1',
          status: UploadedAssetStatus.ATTACHED,
          attachedType: UploadedAssetAttachmentType.RECEIPT_GENERATOR_SESSION,
          attachedId: 'session-1',
        }),
        expect.objectContaining({
          path: '/upload/images/receipts/generated/2026/04/0001000-receipt.png',
          name: '0001000-receipt.png',
          category: UploadedAssetCategory.RECEIPT_GENERATOR_FINAL,
          mimeType: 'image/png',
          sizeBytes: pngBytes.byteLength,
          createdBy: 'admin-1',
          status: UploadedAssetStatus.ATTACHED,
          attachedType: UploadedAssetAttachmentType.RECEIPT,
          attachedId: 'receipt-1',
        }),
      ]),
    }));
  });

  it('removes written generator artifacts when finalize persistence fails after files are saved', async () => {
    mockDb.receiptGeneratorSession.findUnique.mockResolvedValueOnce({
      id: 'session-1',
      createdBy: 'admin-1',
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
      .mockResolvedValueOnce({
        path: '/upload/images/receipts/generated/2026/04/0001000-receipt.png',
        name: '0001000-receipt.png',
      })
      .mockResolvedValueOnce({
        path: '/upload/images/receipts/generated/2026/04/signatures/0001000-receiver-signature.png',
        name: '0001000-receiver-signature.png',
      })
      .mockResolvedValueOnce({
        path: '/upload/images/receipts/generated/2026/04/signatures/0001000-payer-signature.png',
        name: '0001000-payer-signature.png',
      });
    mockDb.uploadedAsset.createMany.mockRejectedValueOnce(new Error('attach failed'));

    const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const makeMockFile = (name: string) => ({
      name,
      type: 'image/png',
      arrayBuffer: async () => pngBytes.buffer,
    }) as unknown as File;

    await expect(finalizeReceiptGeneratorSession(makeUser(), {
      sessionId: 'session-1',
      receiptImage: makeMockFile('receipt.png'),
      receiverSignature: makeMockFile('receiver.png'),
      payerSignature: makeMockFile('payer.png'),
      layoutSnapshot: { receiptNo: '0001000', orderNo: 'Big Alpha-07' },
    })).rejects.toThrow('attach failed');

    expect(mockRm).toHaveBeenCalledTimes(3);
    expect(mockRm).toHaveBeenCalledWith(
      expect.stringContaining('/receipts/generated/2026/04/0001000-receipt.png'),
      { force: true },
    );
    expect(mockRm).toHaveBeenCalledWith(
      expect.stringContaining('/receipts/generated/2026/04/signatures/0001000-receiver-signature.png'),
      { force: true },
    );
    expect(mockRm).toHaveBeenCalledWith(
      expect.stringContaining('/receipts/generated/2026/04/signatures/0001000-payer-signature.png'),
      { force: true },
    );
  });
});
