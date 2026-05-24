import {
  allocateNextReceiptNo,
  formatReceiptNo,
  getSuggestedNextReceiptNo,
  RECEIPT_COUNTER_KEY,
  RECEIPT_COUNTER_START,
} from '@/lib/receipt-number';

describe('receipt-number', () => {
  it('formats receipt numbers as six digits', () => {
    expect(formatReceiptNo(10000)).toBe('010000');
    expect(formatReceiptNo(10001)).toBe('010001');
  });

  it('allocates receipt numbers atomically starting from 010000', async () => {
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
      systemCounter: {
        findUnique: jest.fn().mockImplementation(async () => ({ nextValue: current })),
        upsert,
      },
      receipt: { findFirst: jest.fn().mockResolvedValue(null) },
    } as never;

    const first = await allocateNextReceiptNo(tx);
    const second = await allocateNextReceiptNo(tx);

    expect(first).toBe('010000');
    expect(second).toBe('010001');
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('suggests the next receipt number from the atomic counter and skips existing numbers', async () => {
    const findFirst = jest.fn()
      .mockResolvedValueOnce({ id: 'receipt-010000' })
      .mockResolvedValueOnce(null);

    const tx = {
      systemCounter: { findUnique: jest.fn().mockResolvedValue({ nextValue: 10000 }) },
      receipt: { findFirst },
    } as never;

    await expect(getSuggestedNextReceiptNo(tx)).resolves.toBe('010001');
    expect(findFirst).toHaveBeenNthCalledWith(1, {
      where: { receiptNo: '010000' },
      select: { id: true },
    });
    expect(findFirst).toHaveBeenNthCalledWith(2, {
      where: { receiptNo: '010001' },
      select: { id: true },
    });
  });

  it('skips occupied receipt numbers while allocating from the atomic counter', async () => {
    let current = RECEIPT_COUNTER_START;
    const tx = {
      systemCounter: {
        findUnique: jest.fn().mockResolvedValue({ nextValue: current }),
        upsert: jest.fn().mockImplementation(async ({ create, update }) => {
          if (current === RECEIPT_COUNTER_START) {
            current = create.nextValue;
          } else if (typeof update.nextValue === 'object') {
            current += update.nextValue.increment;
          } else {
            current = update.nextValue;
          }
          return { key: RECEIPT_COUNTER_KEY, nextValue: current };
        }),
      },
      receipt: {
        findFirst: jest.fn()
          .mockResolvedValueOnce({ id: 'receipt-010000' })
          .mockResolvedValueOnce(null),
      },
    } as never;

    await expect(allocateNextReceiptNo(tx)).resolves.toBe('010001');
  });

  it('uses a requested six-digit receipt number and moves the counter past it', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const upsert = jest.fn().mockResolvedValue({ key: RECEIPT_COUNTER_KEY, nextValue: 10006 });

    const tx = {
      receipt: { findFirst },
      systemCounter: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert,
      },
    } as never;

    await expect(allocateNextReceiptNo(tx, { requestedReceiptNo: '10005' })).resolves.toBe('010005');
    expect(findFirst).toHaveBeenCalledWith({
      where: { receiptNo: '010005' },
      select: { id: true },
    });
    expect(upsert).toHaveBeenCalledWith({
      where: { key: RECEIPT_COUNTER_KEY },
      create: {
        key: RECEIPT_COUNTER_KEY,
        nextValue: 10006,
      },
      update: {
        nextValue: 10006,
      },
    });
  });

  it('rejects a requested receipt number that already exists', async () => {
    const tx = {
      receipt: { findFirst: jest.fn().mockResolvedValue({ id: 'receipt-existing' }) },
      systemCounter: { upsert: jest.fn() },
    } as never;

    await expect(allocateNextReceiptNo(tx, { requestedReceiptNo: '010001' })).rejects.toThrow('收据号 010001 已存在，请换一个编号');
  });
});
