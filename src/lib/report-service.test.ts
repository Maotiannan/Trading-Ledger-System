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
});
