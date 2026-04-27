import { allocateNextReceiptNo, formatReceiptNo, RECEIPT_COUNTER_KEY, RECEIPT_COUNTER_START } from '@/lib/receipt-number';

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
    } as never;

    const first = await allocateNextReceiptNo(tx);
    const second = await allocateNextReceiptNo(tx);

    expect(first).toBe('0001000');
    expect(second).toBe('0001001');
    expect(upsert).toHaveBeenCalledTimes(2);
  });
});
