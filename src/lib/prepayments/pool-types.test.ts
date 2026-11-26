import { activePoolRowCount, type DepositPoolRow } from './pool-types';

test('the default pool count excludes spent history but retains held, reserved and unsigned rows', () => {
  const row = (overrides: Partial<DepositPoolRow>) => ({ availableAmount: '0', reservedAmount: '0', held: false, pendingSignature: false, ...overrides } as DepositPoolRow);
  expect(activePoolRowCount([
    row({ availableAmount: '500' }), row({ usedAmount: '500' }),
    row({ reservedAmount: '20' }), row({ held: true }), row({ pendingSignature: true }),
  ])).toBe(4);
});
