import { db } from '@/lib/db';
import { readCustomerHistory } from '@/lib/customer-history-service';

jest.mock('@/lib/db', () => ({
  db: {
    customer: { findFirst: jest.fn() },
    order: { findMany: jest.fn() },
    receipt: { count: jest.fn(), findMany: jest.fn() },
  },
}));

const mockCustomerFindFirst = db.customer.findFirst as jest.Mock;
const mockOrderFindMany = db.order.findMany as jest.Mock;
const mockReceiptCount = db.receipt.count as jest.Mock;
const mockReceiptFindMany = db.receipt.findMany as jest.Mock;

describe('readCustomerHistory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCustomerFindFirst.mockResolvedValue({
      id: 'customer-1',
      mark: 'MAB',
      orderName: 'MAB-1',
      name: 'Mamadou Aliou Barry',
      orderNames: [
        { orderName: 'MAB-1', normalizedOrderName: 'mab-1', isPrimary: true },
        { orderName: 'MARY', normalizedOrderName: 'mary', isPrimary: false },
      ],
    });
    mockReceiptCount.mockResolvedValue(2);
    mockReceiptFindMany.mockResolvedValue([
      {
        id: 'receipt-2',
        receiptNo: '0010002',
        orderNo: 'MARY-01',
        invNo: 'INV-2',
        usd: 400,
        status: 'RECEIVED',
        date: new Date('2026-07-02T00:00:00.000Z'),
        createdAt: new Date('2026-07-03T08:00:00.000Z'),
        imageUrl: '/upload/images/receipts/ocr/mary.jpg',
        imageName: 'mary.jpg',
        creator: { name: 'User', email: 'user@example.com' },
        order: { invoice: { invNo: 'INV-2' } },
      },
      {
        id: 'receipt-1',
        receiptNo: '0010001',
        orderNo: 'MAB-1-10',
        invNo: 'INV-1',
        usd: 750,
        status: 'Bank_Transfer',
        date: null,
        createdAt: new Date('2026-07-01T08:00:00.000Z'),
        imageUrl: null,
        imageName: null,
        creator: null,
        order: null,
      },
    ]);
  });

  it('combines every ORDER_NAME for one customer and uses live balances', async () => {
    mockOrderFindMany.mockResolvedValue([
      {
        id: 'order-mab',
        orderNo: 'MAB-1-10',
        amount: 1000,
        orderBalance: 9999,
        receipts: [{ usd: 750, status: 'RECEIVED' }],
        invoice: { invNo: 'INV-1', shipDate: null, releaseDate: null },
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      },
      {
        id: 'order-mary',
        orderNo: 'MARY-01',
        amount: 500,
        orderBalance: 9999,
        receipts: [
          { usd: 400, status: 'Bank_Transfer' },
          { usd: 50, status: 'SIGNING_PENDING' },
        ],
        invoice: { invNo: 'INV-2', shipDate: null, releaseDate: new Date('2026-07-02T00:00:00.000Z') },
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
      },
    ]);

    const result = await readCustomerHistory({
      customerId: 'customer-1',
      orderName: null,
      orderPage: 1,
      orderPageSize: 10,
      receiptPage: 1,
      receiptPageSize: 10,
      customerWhere: { id: { in: ['customer-1'] } },
      orderWhere: { createdBy: { in: ['user-1'] } },
      receiptWhere: { createdBy: { in: ['user-1'] } },
    });

    expect(result.data.orders).toEqual([
      expect.objectContaining({ id: 'order-mab', outstanding: 250 }),
      expect.objectContaining({ id: 'order-mary', outstanding: 100 }),
    ]);
    expect(result.data.orderNames).toEqual(['MAB-1', 'MARY']);
    expect(result.data.receipts[0]).toEqual(expect.objectContaining({
      id: 'receipt-2',
      imageUrl: '/upload/images/receipts/ocr/mary.jpg',
      boundInvNo: 'INV-2',
      creatorName: 'User',
    }));
    expect(mockOrderFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: [{ customerId: 'customer-1' }, { createdBy: { in: ['user-1'] } }] },
    }));
    expect(mockReceiptCount).toHaveBeenCalledWith({
      where: { AND: [{ customerId: 'customer-1' }, { createdBy: { in: ['user-1'] } }] },
    });
  });

  it('keeps the existing single ORDER_NAME filter for Customer Management', async () => {
    mockOrderFindMany.mockResolvedValue([
      {
        id: 'order-mab',
        orderNo: 'MAB-1-10',
        amount: 1000,
        orderBalance: 250,
        receipts: [],
        invoice: { invNo: 'INV-1', shipDate: null, releaseDate: null },
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      },
      {
        id: 'order-mary',
        orderNo: 'MARY-01',
        amount: 500,
        orderBalance: 0,
        receipts: [],
        invoice: { invNo: 'INV-2', shipDate: null, releaseDate: null },
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
      },
    ]);

    const result = await readCustomerHistory({
      customerId: 'customer-1',
      orderName: 'MAB-1',
      orderPage: 1,
      orderPageSize: 10,
      receiptPage: 1,
      receiptPageSize: 10,
    });

    expect(result.data.orders.map((row) => row.id)).toEqual(['order-mab']);
  });
});
