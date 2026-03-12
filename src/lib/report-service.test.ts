import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { getOwnerVisibleIds } from '@/lib/resource-visibility';
import { exportReport } from '@/lib/report-service';

jest.mock('@/lib/db', () => ({
  db: {
    invoice: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    receipt: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    detail: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    swift: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));

jest.mock('@/lib/audit', () => ({
  recordAuditEvent: jest.fn(),
}));

jest.mock('@/lib/resource-visibility', () => ({
  buildDetailVisibilityWhere: jest.fn(() => ({})),
  buildInvoiceVisibilityWhere: jest.fn(() => ({})),
  buildOrderVisibilityWhere: jest.fn(() => ({})),
  buildReceiptVisibilityWhere: jest.fn(() => ({})),
  buildSwiftVisibilityWhere: jest.fn(() => ({})),
  getOwnerVisibleIds: jest.fn(),
}));

const mockDb = db as unknown as {
  invoice: { findMany: jest.Mock; count: jest.Mock };
  receipt: { findMany: jest.Mock; count: jest.Mock };
  detail: { findMany: jest.Mock; count: jest.Mock };
  swift: { findMany: jest.Mock; count: jest.Mock };
};
const mockRecordAuditEvent = recordAuditEvent as jest.Mock;
const mockGetOwnerVisibleIds = getOwnerVisibleIds as jest.Mock;

function makeUser() {
  return {
    id: 'admin-1',
    email: 'admin@example.com',
    name: 'Admin',
    role: 'ADMIN',
    level: 1,
    parentId: null,
    createdById: null,
  };
}

describe('report-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOwnerVisibleIds.mockResolvedValue(['admin-1']);
  });

  it('exports excel report and records audit', async () => {
    mockDb.invoice.findMany.mockResolvedValueOnce([]);
    mockDb.receipt.findMany.mockResolvedValueOnce([]);
    mockDb.detail.findMany.mockResolvedValueOnce([]);
    mockDb.swift.findMany.mockResolvedValueOnce([]);

    const result = await exportReport(makeUser() as never, 'excel');

    expect(result.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(result.fileName).toMatch(/trading-ledger-report-\d{4}-\d{2}-\d{2}\.xlsx/);
    expect(result.fileBuffer.length).toBeGreaterThan(0);
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'REPORT_EXPORT',
      metadata: expect.objectContaining({ format: 'excel', invoiceCount: 0 }),
    }));
  });

  it('exports pdf report with aggregated counts and records audit', async () => {
    mockDb.invoice.count.mockResolvedValueOnce(2);
    mockDb.receipt.count.mockResolvedValueOnce(3);
    mockDb.detail.count.mockResolvedValueOnce(4);
    mockDb.swift.count.mockResolvedValueOnce(5);
    mockDb.receipt.findMany.mockResolvedValueOnce([
      {
        orderNo: 'IB-01',
        usd: 120,
        status: 'MATCHED',
        createdAt: new Date('2026-03-12T08:00:00.000Z'),
      },
    ]);

    const result = await exportReport(makeUser() as never, 'pdf');

    expect(result.contentType).toBe('application/pdf');
    expect(result.fileName).toMatch(/trading-ledger-report-\d{4}-\d{2}-\d{2}\.pdf/);
    expect(result.fileBuffer.length).toBeGreaterThan(0);
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'REPORT_EXPORT',
      metadata: expect.objectContaining({
        format: 'pdf',
        invoiceCount: 2,
        receiptCount: 3,
        detailCount: 4,
        swiftCount: 5,
      }),
    }));
  });

  it('exports excel report using visible owner scope and linked receipt totals', async () => {
    mockDb.invoice.findMany.mockResolvedValueOnce([
      {
        invNo: 'INV-1',
        orders: [
          {
            amount: 100,
            receipts: [{ usd: 40 }, { usd: 10 }],
          },
          {
            amount: 50,
            receipts: [{ usd: 20 }],
          },
        ],
      },
    ]);
    mockDb.receipt.findMany.mockResolvedValueOnce([
      {
        receiptNo: 'R-1',
        orderNo: 'IB-01',
        usd: 60,
        status: 'MATCHED',
        date: new Date('2026-03-12T00:00:00.000Z'),
      },
    ]);
    mockDb.detail.findMany.mockResolvedValueOnce([{ id: 'detail-1' }]);
    mockDb.swift.findMany.mockResolvedValueOnce([{ id: 'swift-1' }]);

    const result = await exportReport(makeUser() as never, 'excel');

    expect(mockGetOwnerVisibleIds).toHaveBeenCalledWith(expect.objectContaining({ id: 'admin-1' }));
    expect(mockDb.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        orders: expect.objectContaining({
          include: expect.objectContaining({
            receipts: expect.objectContaining({
              select: { usd: true },
            }),
          }),
        }),
      }),
    }));
    expect(result.fileBuffer.length).toBeGreaterThan(0);
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'REPORT_EXPORT',
      metadata: expect.objectContaining({
        format: 'excel',
        invoiceCount: 1,
        receiptCount: 1,
        detailCount: 1,
        swiftCount: 1,
      }),
    }));
  });

  it('exports excel report when receipt fallback fields are empty', async () => {
    mockDb.invoice.findMany.mockResolvedValueOnce([]);
    mockDb.receipt.findMany.mockResolvedValueOnce([
      {
        receiptNo: '',
        orderNo: null,
        usd: 10,
        status: 'SR_Received',
        date: null,
      },
    ]);
    mockDb.detail.findMany.mockResolvedValueOnce([]);
    mockDb.swift.findMany.mockResolvedValueOnce([]);

    const result = await exportReport(makeUser() as never, 'excel');

    expect(result.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(result.fileBuffer.length).toBeGreaterThan(0);
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        format: 'excel',
        receiptCount: 1,
      }),
    }));
  });

  it('exports pdf report when receipts overflow one page row budget and order number is missing', async () => {
    mockDb.invoice.count.mockResolvedValueOnce(1);
    mockDb.receipt.count.mockResolvedValueOnce(25);
    mockDb.detail.count.mockResolvedValueOnce(0);
    mockDb.swift.count.mockResolvedValueOnce(0);
    mockDb.receipt.findMany.mockResolvedValueOnce(
      Array.from({ length: 25 }, (_, index) => ({
        orderNo: index === 0 ? null : `IB-${index + 1}`,
        usd: 10 + index,
        status: 'MATCHED',
        createdAt: new Date(`2026-03-${String((index % 9) + 1).padStart(2, '0')}T08:00:00.000Z`),
      }))
    );

    const result = await exportReport(makeUser() as never, 'pdf');

    expect(result.contentType).toBe('application/pdf');
    expect(result.fileBuffer.length).toBeGreaterThan(0);
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        format: 'pdf',
        receiptCount: 25,
      }),
    }));
  });
});
