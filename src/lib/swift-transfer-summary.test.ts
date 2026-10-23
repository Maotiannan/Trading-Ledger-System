import { calculateSwiftTransferSummary } from './swift-transfer-summary';

const received = (amount: number | string) => ({ amount, status: 'RECEIVED', hasError: false });
const pending = (amount: number | string) => ({ amount, status: 'Bank_Transfer', hasError: false });

describe('SWIFT transfer summary', () => {
  it('keeps a signed partial transfer open for more copies', () => {
    expect(calculateSwiftTransferSummary(75093, [received(50000)])).toMatchObject({
      transferredAmount: 50000, remainingAmount: 25093, isComplete: false, status: 'Waiting_SWIFT',
    });
  });
  it('requires every valid copy to be received', () => {
    expect(calculateSwiftTransferSummary(75093, [received(50000), pending(25093)])).toMatchObject({ isComplete: false, status: 'Bank_Transfer' });
    expect(calculateSwiftTransferSummary(75093, [received(50000), received(25093)]).isComplete).toBe(true);
  });
  it('waits for sufficient copies regardless of the first copy signoff', () => {
    expect(calculateSwiftTransferSummary(75093, [pending(50000)]).status).toBe('Waiting_SWIFT');
    expect(calculateSwiftTransferSummary(1000, [pending(960)]).status).toBe('Bank_Transfer');
    expect(calculateSwiftTransferSummary(1000, [pending(959.99)]).status).toBe('Waiting_SWIFT');
    expect(calculateSwiftTransferSummary(0, [pending(0)]).status).toBe('Waiting_SWIFT');
  });
  it('accepts eight received transfers with bank fees while retaining the actual balance', () => {
    expect(calculateSwiftTransferSummary(80000, Array.from({ length: 8 }, () => received(9980)))).toMatchObject({
      transferredAmount: 79840, remainingAmount: 160, feeTolerance: 320, validSwiftCount: 8,
      isComplete: true, status: 'RECEIVED',
    });
  });
  it('enforces the exact per-copy fee boundary', () => {
    expect(calculateSwiftTransferSummary(80000, Array.from({ length: 8 }, () => received(9960))).isComplete).toBe(true);
    expect(calculateSwiftTransferSummary(80000, [...Array.from({ length: 7 }, () => received(9960)), received(9959.99)]).isComplete).toBe(false);
  });
  it('excludes erroneous copies from amounts and fee allowance', () => {
    expect(calculateSwiftTransferSummary(1000, [received(900), { amount: 100, status: 'ERROR', hasError: true }])).toMatchObject({
      transferredAmount: 900, remainingAmount: 100, feeTolerance: 40, validSwiftCount: 1, isComplete: false,
    });
  });
  it('uses exact decimal arithmetic and detects overpayment', () => {
    expect(calculateSwiftTransferSummary('0.30', [received('0.10'), received('0.20')])).toMatchObject({ remainingAmount: 0, isComplete: true, isOverpaid: false });
    expect(calculateSwiftTransferSummary(100, [received('100.01')])).toMatchObject({ isOverpaid: true, isComplete: false });
  });
  it('recalculates after deletion and supports a configured fee cap', () => {
    expect(calculateSwiftTransferSummary(1000, [received(920)], 40).isComplete).toBe(false);
    expect(calculateSwiftTransferSummary(1000, [received(920)], 80).isComplete).toBe(true);
    expect(calculateSwiftTransferSummary(1000, [])).toMatchObject({ status: 'Waiting_SWIFT', isComplete: false });
  });
});
