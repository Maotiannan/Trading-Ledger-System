import {
  allocateNextReceiptNo,
  formatReceiptNo,
  getSuggestedNextReceiptNo,
  RECEIPT_COUNTER_KEY,
  RECEIPT_COUNTER_START,
} from '@/lib/receipt-number';

describe('receipt-number', () => {
  it('formats receipt numbers as seven digits', () => {
    expect(formatReceiptNo(1000)).toBe('0001000');
    expect(formatReceiptNo(1001)).toBe('0001001');
  });

  it('allocates receipt numbers atomically starting from 0001000', async () => {
    let current = RECEIPT_COUNTER_START;
    const upsert = jest.fn().mockImplementation(async ({ create, update }) => {
      if (current === RECEIPT_COUNTER_START) {
        current = create.nextValue;
        return { key: RECEIPT_COUNTER_KEY, nextValue: current };
      }
      current += update.nextValue.increment;
      return { key: RECEIPT_COUNTER_KEY, nextValue: current };
    });

    const tx = {
      systemCounter: { upsert },
      receipt: { findFirst: jest.fn().mockResolvedValue(null) },
    } as never;

    const first = await allocateNextReceiptNo(tx);
    const second = await allocateNextReceiptNo(tx);

    expect(first).toBe('0001000');
    expect(second).toBe('0001001');
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('suggests the next receipt number from the largest numeric value in the latest ten receipts', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { receiptNo: '0001004' },
      { receiptNo: 'manual-note' },
      { receiptNo: '0001009' },
      { receiptNo: null },
      { receiptNo: '0001007' },
    ]);

    const tx = {
      receipt: { findMany },
    } as never;

    await expect(getSuggestedNextReceiptNo(tx)).resolves.toBe('0001010');
    expect(findMany).toHaveBeenCalledWith({
      where: { receiptNo: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { receiptNo: true },
    });
  });

  it('uses a requested receipt number and moves the counter past it', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const upsert = jest.fn().mockResolvedValue({ key: RECEIPT_COUNTER_KEY, nextValue: 2002 });

    const tx = {
      receipt: { findFirst },
      systemCounter: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert,
      },
    } as never;

    await expect(allocateNextReceiptNo(tx, { requestedReceiptNo: '2001' })).resolves.toBe('0002001');
    expect(findFirst).toHaveBeenCalledWith({
      where: { receiptNo: '0002001' },
      select: { id: true },
    });
    expect(upsert).toHaveBeenCalledWith({
      where: { key: RECEIPT_COUNTER_KEY },
      create: {
        key: RECEIPT_COUNTER_KEY,
        nextValue: 2002,
      },
      update: {
        nextValue: 2002,
      },
    });
  });

  it('rejects a requested receipt number that already exists', async () => {
    const tx = {
      receipt: { findFirst: jest.fn().mockResolvedValue({ id: 'receipt-existing' }) },
      systemCounter: { upsert: jest.fn() },
    } as never;

    await expect(allocateNextReceiptNo(tx, { requestedReceiptNo: '0001001' })).rejects.toThrow('收据号 0001001 已存在，请换一个编号');
  });
});
