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
import { ensureDepositPoolInvoice, updateOrderBalance } from '@/lib/matching';
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
    invoice: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    order: {
      create: jest.fn(),
    },
    orderAlias: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
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

jest.mock('@/lib/matching', () => ({
  ensureDepositPoolInvoice: jest.fn(),
  updateOrderBalance: jest.fn(),
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
  invoice: { findFirst: jest.Mock; create: jest.Mock };
  order: { create: jest.Mock };
  orderAlias: { deleteMany: jest.Mock; createMany: jest.Mock };
  uploadedAsset: { createMany: jest.Mock };
  $transaction: jest.Mock;
};
const mockLookupInvoiceOrderContext = lookupInvoiceOrderContext as jest.Mock;
const mockAllocateNextReceiptNo = allocateNextReceiptNo as jest.Mock;
const mockSaveReceiptGeneratorArtifact = saveReceiptGeneratorArtifact as jest.Mock;
const mockEnsureDepositPoolInvoice = ensureDepositPoolInvoice as jest.Mock;
const mockUpdateOrderBalance = updateOrderBalance as jest.Mock;
const mockCanAccessOwnedResourceAsync = canAccessOwnedResourceAsync as jest.Mock;
const mockRecordAuditEvent = recordAuditEvent as jest.Mock;
const mockRm = rm as jest.MockedFunction<typeof rm>;

describe('receipt-generator-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(mockDb));
    mockCanAccessOwnedResourceAsync.mockResolvedValue(true);
    mockAllocateNextReceiptNo.mockResolvedValue('0010000');
    mockEnsureDepositPoolInvoice.mockResolvedValue('deposit-pool-invoice');
    mockUpdateOrderBalance.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
    mockDb.invoice.findFirst.mockResolvedValue({ id: 'deposit-pool-invoice', invNo: 'DEPOSIT_POOL' });
    mockDb.invoice.create.mockResolvedValue({ id: 'deposit-pool-invoice', invNo: 'DEPOSIT_POOL' });
    mockDb.order.create.mockResolvedValue({ id: 'order-deposit-pool', orderNo: 'AKD-01' });
    mockDb.orderAlias.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.orderAlias.createMany.mockResolvedValue({ count: 1 });
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
      receiptNo: '0010000',
      status: ReceiptStatus.SIGNING_PENDING,
    });
    mockDb.receiptGeneratorSession.create.mockResolvedValueOnce({
      id: 'session-1',
      receiptId: 'receipt-1',
      receiptNo: '0010000',
      status: ReceiptGeneratorSessionStatus.PENDING,
    });

    const result = await createReceiptGeneratorSession(makeUser(), {
      orderNo: 'Big Alpha-07',
      usdAmount: 2500,
      paymentMode: 'Transfer',
    });

    expect(mockAllocateNextReceiptNo).toHaveBeenCalledWith(mockDb);
    expect(mockDb.receipt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        receiptNo: '0010000',
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
          paymentMode: 'Virement',
          fraisStatus: 'Payé',
        }),
      }),
    }));
    expect(result.data.signingPath).toBe('/receipt-generator/session-1');
    expect(mockRecordAuditEvent).toHaveBeenCalled();
  });

  it('persists deposit signed receipts as deposit records and stores the selected receiver in the layout snapshot', async () => {
    mockDb.receipt.create.mockResolvedValueOnce({
      id: 'receipt-deposit',
      receiptNo: '0010000',
      status: ReceiptStatus.SIGNING_PENDING,
    });
    mockDb.receiptGeneratorSession.create.mockResolvedValueOnce({
      id: 'session-deposit',
      receiptId: 'receipt-deposit',
      receiptNo: '0010000',
      status: ReceiptGeneratorSessionStatus.PENDING,
    });

    await createReceiptGeneratorSession(makeUser(), {
      orderNo: 'Big Alpha-07',
      usdAmount: 500,
      paymentMode: 'Cash',
      fraisStatus: 'Non payé',
      paymentType: 'Deposit',
      receivedBy: 'Transferred via bank account',
    });

    expect(mockDb.receipt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        isDeposit: true,
      }),
    }));
    expect(mockDb.receiptGeneratorSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        balanceAfter: null,
        motif: 'Deposit for Big Alpha-07',
        layoutSnapshot: expect.objectContaining({
          paymentType: 'Deposit',
          paymentMode: 'Espèces',
          fraisStatus: 'Non payé',
          receivedBy: 'Transferred via bank account',
          resteAPayer: '',
          balanceAfter: null,
        }),
      }),
    }));
  });

  it('creates a deposit-pool order when a deposit signed receipt has customer context but no invoice order yet', async () => {
    mockLookupInvoiceOrderContext.mockResolvedValueOnce({
      data: {
        derivedOrderName: 'AKD',
        inferredCustomer: {
          id: 'customer-akd',
          mark: 'A K D',
          orderName: 'AKD',
          companyName: null,
          name: 'Abdoulaye Diallo',
          phone: '+224 622 05 71 47',
          city: 'Conakry',
        },
        exactMatches: [],
      },
    });
    mockDb.receipt.create.mockResolvedValueOnce({
      id: 'receipt-akd-deposit',
      receiptNo: '0010000',
      status: ReceiptStatus.SIGNING_PENDING,
    });
    mockDb.receiptGeneratorSession.create.mockResolvedValueOnce({
      id: 'session-akd-deposit',
      receiptId: 'receipt-akd-deposit',
      receiptNo: '0010000',
      status: ReceiptGeneratorSessionStatus.PENDING,
    });

    const result = await createReceiptGeneratorSession(makeUser(), {
      orderNo: 'AKD-01',
      usdAmount: 1000,
      paymentType: 'Deposit',
    });

    expect(mockDb.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        invoiceId: 'deposit-pool-invoice',
        orderNo: 'AKD-01',
        amount: 0,
        customerId: 'customer-akd',
        customerMark: 'A K D',
        customerName: 'Abdoulaye Diallo',
        customerPhone: '+224 622 05 71 47',
        needsCustomerFix: false,
      }),
    }));
    expect(mockDb.receipt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        orderId: 'order-deposit-pool',
        orderNo: 'AKD-01',
        invNo: null,
        isDeposit: true,
        payer: 'Abdoulaye Diallo "A K D"',
        needsCustomerFix: false,
      }),
    }));
    expect(mockDb.receiptGeneratorSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        orderNo: 'AKD-01',
        invNo: null,
        balanceBefore: null,
        balanceAfter: null,
        motif: 'Deposit for AKD-01',
        layoutSnapshot: expect.objectContaining({
          receiptNo: '0010000',
          orderNo: 'AKD-01',
          invNo: null,
          paymentType: 'Deposit',
          resteAPayer: '',
        }),
      }),
    }));
    expect(result.data.signingPath).toBe('/receipt-generator/session-akd-deposit');
  });

  it('uses the customer profile name when the order row customerName is a fallback alias', async () => {
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
    mockDb.receipt.create.mockResolvedValueOnce({
      id: 'receipt-pikin',
      receiptNo: '0010000',
      status: ReceiptStatus.SIGNING_PENDING,
    });
    mockDb.receiptGeneratorSession.create.mockResolvedValueOnce({
      id: 'session-pikin',
      receiptId: 'receipt-pikin',
      receiptNo: '0010000',
      status: ReceiptGeneratorSessionStatus.PENDING,
    });

    await createReceiptGeneratorSession(makeUser(), {
      orderNo: 'PIKIN-20',
      usdAmount: 1,
      paymentMode: 'Cash',
    });

    expect(mockDb.receipt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        payer: 'Mamadou Dian Diallo "PIKIN"',
      }),
    }));
    expect(mockDb.receiptGeneratorSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        customerName: 'Mamadou Dian Diallo',
        layoutSnapshot: expect.objectContaining({
          clientName: 'Mamadou Dian Diallo "PIKIN"',
        }),
      }),
    }));
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
      receiptNo: '0010000',
      status: ReceiptStatus.SIGNING_PENDING,
    });
    mockDb.receiptGeneratorSession.create.mockResolvedValueOnce({
      id: 'session-composite',
      receiptId: 'receipt-composite',
      receiptNo: '0010000',
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
      receiptNo: '0010000',
      layoutSnapshot: { receiptNo: '0010000' },
      status: ReceiptGeneratorSessionStatus.PENDING,
      receipt: {
        id: 'receipt-1',
        orderId: 'order-1',
        createdBy: 'admin-1',
        status: ReceiptStatus.SIGNING_PENDING,
        receiptNo: '0010000',
      },
    });
    mockSaveReceiptGeneratorArtifact
      .mockResolvedValueOnce({
        path: '/upload/images/receipts/generated/2026/04/0010000-receipt.png',
        name: '0010000-receipt.png',
      })
      .mockResolvedValueOnce({
        path: '/upload/images/receipts/generated/2026/04/signatures/0010000-receiver-signature.png',
        name: '0010000-receiver-signature.png',
      })
      .mockResolvedValueOnce({
        path: '/upload/images/receipts/generated/2026/04/signatures/0010000-payer-signature.png',
        name: '0010000-payer-signature.png',
      });
    mockDb.receiptGeneratorSession.update.mockResolvedValueOnce({
      id: 'session-1',
      finalImageUrl: '/upload/images/receipts/generated/2026/04/0010000-receipt.png',
      finalImageName: '0010000-receipt.png',
      receipt: {
        id: 'receipt-1',
        receiptNo: '0010000',
        status: ReceiptStatus.SR_Received,
        imageUrl: '/upload/images/receipts/generated/2026/04/0010000-receipt.png',
        imageName: '0010000-receipt.png',
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
      layoutSnapshot: { receiptNo: '0010000', orderNo: 'Big Alpha-07' },
    });

    expect(mockDb.receipt.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'receipt-1' },
      data: expect.objectContaining({
        status: ReceiptStatus.SR_Received,
      }),
    }));
    expect(mockDb.receiptGeneratorSession.update).toHaveBeenCalled();
    expect(mockUpdateOrderBalance).toHaveBeenCalledWith('order-1', mockDb);
    expect(result.data.receiptStatus).toBe('SR_Received');
  });

  it('registers generator signatures and final image as attached assets on finalize', async () => {
    mockDb.receiptGeneratorSession.findUnique.mockResolvedValueOnce({
      id: 'session-1',
      createdBy: 'admin-1',
      receiptId: 'receipt-1',
      receiptNo: '0010000',
      layoutSnapshot: { receiptNo: '0010000' },
      status: ReceiptGeneratorSessionStatus.PENDING,
      receipt: {
        id: 'receipt-1',
        createdBy: 'admin-1',
        status: ReceiptStatus.SIGNING_PENDING,
        receiptNo: '0010000',
      },
    });
    mockSaveReceiptGeneratorArtifact
      .mockResolvedValueOnce({
        path: '/upload/images/receipts/generated/2026/04/0010000-receipt.png',
        name: '0010000-receipt.png',
      })
      .mockResolvedValueOnce({
        path: '/upload/images/receipts/generated/2026/04/signatures/0010000-receiver-signature.png',
        name: '0010000-receiver-signature.png',
      })
      .mockResolvedValueOnce({
        path: '/upload/images/receipts/generated/2026/04/signatures/0010000-payer-signature.png',
        name: '0010000-payer-signature.png',
      });
    mockDb.uploadedAsset.createMany.mockResolvedValueOnce({ count: 3 });
    mockDb.receiptGeneratorSession.update.mockResolvedValueOnce({
      id: 'session-1',
      finalImageUrl: '/upload/images/receipts/generated/2026/04/0010000-receipt.png',
      finalImageName: '0010000-receipt.png',
      receipt: {
        id: 'receipt-1',
        receiptNo: '0010000',
        status: ReceiptStatus.SR_Received,
        imageUrl: '/upload/images/receipts/generated/2026/04/0010000-receipt.png',
        imageName: '0010000-receipt.png',
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
      layoutSnapshot: { receiptNo: '0010000', orderNo: 'Big Alpha-07' },
    });

    expect(mockDb.uploadedAsset.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({
          path: '/upload/images/receipts/generated/2026/04/signatures/0010000-receiver-signature.png',
          name: '0010000-receiver-signature.png',
          category: UploadedAssetCategory.RECEIPT_GENERATOR_SIGNATURE,
          mimeType: 'image/png',
          sizeBytes: pngBytes.byteLength,
          createdBy: 'admin-1',
          status: UploadedAssetStatus.ATTACHED,
          attachedType: UploadedAssetAttachmentType.RECEIPT_GENERATOR_SESSION,
          attachedId: 'session-1',
        }),
        expect.objectContaining({
          path: '/upload/images/receipts/generated/2026/04/signatures/0010000-payer-signature.png',
          name: '0010000-payer-signature.png',
          category: UploadedAssetCategory.RECEIPT_GENERATOR_SIGNATURE,
          mimeType: 'image/png',
          sizeBytes: pngBytes.byteLength,
          createdBy: 'admin-1',
          status: UploadedAssetStatus.ATTACHED,
          attachedType: UploadedAssetAttachmentType.RECEIPT_GENERATOR_SESSION,
          attachedId: 'session-1',
        }),
        expect.objectContaining({
          path: '/upload/images/receipts/generated/2026/04/0010000-receipt.png',
          name: '0010000-receipt.png',
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
      receiptNo: '0010000',
      layoutSnapshot: { receiptNo: '0010000' },
      status: ReceiptGeneratorSessionStatus.PENDING,
      receipt: {
        id: 'receipt-1',
        createdBy: 'admin-1',
        status: ReceiptStatus.SIGNING_PENDING,
        receiptNo: '0010000',
      },
    });
    mockSaveReceiptGeneratorArtifact
      .mockResolvedValueOnce({
        path: '/upload/images/receipts/generated/2026/04/0010000-receipt.png',
        name: '0010000-receipt.png',
      })
      .mockResolvedValueOnce({
        path: '/upload/images/receipts/generated/2026/04/signatures/0010000-receiver-signature.png',
        name: '0010000-receiver-signature.png',
      })
      .mockResolvedValueOnce({
        path: '/upload/images/receipts/generated/2026/04/signatures/0010000-payer-signature.png',
        name: '0010000-payer-signature.png',
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
      layoutSnapshot: { receiptNo: '0010000', orderNo: 'Big Alpha-07' },
    })).rejects.toThrow('attach failed');

    expect(mockRm).toHaveBeenCalledTimes(3);
    expect(mockRm).toHaveBeenCalledWith(
      expect.stringContaining('/receipts/generated/2026/04/0010000-receipt.png'),
      { force: true },
    );
    expect(mockRm).toHaveBeenCalledWith(
      expect.stringContaining('/receipts/generated/2026/04/signatures/0010000-receiver-signature.png'),
      { force: true },
    );
    expect(mockRm).toHaveBeenCalledWith(
      expect.stringContaining('/receipts/generated/2026/04/signatures/0010000-payer-signature.png'),
      { force: true },
    );
  });
});
