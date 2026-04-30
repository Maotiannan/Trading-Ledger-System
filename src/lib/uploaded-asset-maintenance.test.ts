import { ReceiptGeneratorSessionStatus, ReceiptStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import {
  getUploadedAssetCleanupSettings,
  invalidateSystemSettingsCache,
} from '@/lib/system-settings';
import { cleanupStaleSigningPendingReceipts } from '@/lib/uploaded-asset-maintenance';

jest.mock('@/lib/db', () => ({
  db: {
    systemSetting: {
      findMany: jest.fn(),
    },
    receiptGeneratorSession: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    receipt: {
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/audit', () => ({
  recordAuditEvent: jest.fn(),
}));

const mockFindMany = db.systemSetting.findMany as jest.Mock;
const mockReceiptGeneratorSessionFindMany = db.receiptGeneratorSession.findMany as jest.Mock;
const mockRecordAuditEvent = recordAuditEvent as jest.Mock;
const mockDb = db as unknown as {
  receiptGeneratorSession: {
    findMany: jest.Mock;
    update: jest.Mock;
  };
  receipt: {
    delete: jest.Mock;
  };
  $transaction: jest.Mock;
};

describe('uploaded-asset-maintenance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateSystemSettingsCache();
    mockFindMany.mockResolvedValue([]);
    mockReceiptGeneratorSessionFindMany.mockResolvedValue([]);
    mockDb.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      receiptGeneratorSession: {
        update: mockDb.receiptGeneratorSession.update,
      },
      receipt: {
        delete: mockDb.receipt.delete,
      },
    }));
  });

  it('returns uploaded asset cleanup ttl defaults when no overrides exist', async () => {
    const settings = await getUploadedAssetCleanupSettings();

    expect(settings.stagedTtlHours).toBe(24);
    expect(settings.signingPendingTtlHours).toBe(72);
  });

  it('honors persisted uploaded asset cleanup ttl overrides', async () => {
    mockFindMany.mockResolvedValue([
      { key: 'UPLOADED_ASSET_STAGED_TTL_HOURS', value: '36' },
      { key: 'SIGNING_PENDING_TTL_HOURS', value: '96' },
    ]);

    const settings = await getUploadedAssetCleanupSettings();

    expect(settings.stagedTtlHours).toBe(36);
    expect(settings.signingPendingTtlHours).toBe(96);
  });

  it('falls back to defaults when uploaded asset cleanup ttl overrides are below minimums', async () => {
    mockFindMany.mockResolvedValue([
      { key: 'UPLOADED_ASSET_STAGED_TTL_HOURS', value: '0' },
      { key: 'SIGNING_PENDING_TTL_HOURS', value: '12' },
    ]);

    const settings = await getUploadedAssetCleanupSettings();

    expect(settings.stagedTtlHours).toBe(24);
    expect(settings.signingPendingTtlHours).toBe(72);
  });

  it('falls back to defaults when uploaded asset cleanup ttl overrides are malformed or non-finite', async () => {
    mockFindMany.mockResolvedValue([
      { key: 'UPLOADED_ASSET_STAGED_TTL_HOURS', value: 'Infinity' },
      { key: 'SIGNING_PENDING_TTL_HOURS', value: 'not-a-number' },
    ]);

    const settings = await getUploadedAssetCleanupSettings();

    expect(settings.stagedTtlHours).toBe(24);
    expect(settings.signingPendingTtlHours).toBe(72);
  });

  it('cancels stale signing sessions and removes untouched SIGNING_PENDING receipts after ttl', async () => {
    const now = new Date('2026-05-03T00:00:00.000Z');
    mockReceiptGeneratorSessionFindMany.mockResolvedValueOnce([
      {
        id: 'session-1',
        receiptId: 'receipt-1',
        receiptNo: '0001000',
        createdBy: 'admin-1',
        createdAt: new Date('2026-04-29T00:00:00.000Z'),
        finalImageUrl: null,
        receipt: {
          id: 'receipt-1',
          receiptNo: '0001000',
          status: ReceiptStatus.SIGNING_PENDING,
          imageUrl: null,
        },
      },
    ]);
    mockDb.receiptGeneratorSession.update.mockResolvedValueOnce({
      id: 'session-1',
      status: ReceiptGeneratorSessionStatus.CANCELLED,
    });
    mockDb.receipt.delete.mockResolvedValueOnce({
      id: 'receipt-1',
    });

    const result = await cleanupStaleSigningPendingReceipts({ now });

    expect(mockReceiptGeneratorSessionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: ReceiptGeneratorSessionStatus.PENDING,
        createdAt: { lte: new Date('2026-04-30T00:00:00.000Z') },
        finalImageUrl: null,
        receipt: {
          is: {
            status: ReceiptStatus.SIGNING_PENDING,
            imageUrl: null,
          },
        },
      }),
      include: { receipt: true },
    }));
    expect(mockDb.receiptGeneratorSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { status: ReceiptGeneratorSessionStatus.CANCELLED },
    });
    expect(mockDb.receipt.delete).toHaveBeenCalledWith({
      where: { id: 'receipt-1' },
    });
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: expect.any(String),
      actorId: 'admin-1',
      targetId: 'receipt-1',
      metadata: expect.objectContaining({
        sessionId: 'session-1',
        receiptNo: '0001000',
      }),
    }));
    expect(result.cancelledSessions).toBe(1);
    expect(result.deletedReceipts).toBe(1);
  });
});
