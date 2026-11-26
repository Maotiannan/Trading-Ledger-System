import { computeOrderBalanceFromReceipts } from '@/lib/order-balance';

it('uses only the assigned 500 from a 3000 receipt, not the original again', () => {
  expect(computeOrderBalanceFromReceipts({ amount: 500,
    receipts: [{ usd: 3000, status: 'RECEIVED', funding: { id: 'f' } }],
    paymentAllocations: [{ amount: 500, funding: { active: true, receipt: { status: 'RECEIVED' } } }],
  })).toBe(0);
});
it('does not fall back to full receipt when all its allocations are released', () => {
  expect(computeOrderBalanceFromReceipts({ amount: 500,
    receipts: [{ usd: 3000, status: 'RECEIVED', funding: { id: 'f' } }], paymentAllocations: [],
  })).toBe(500);
});
it('combines legacy receipt contributions and allocations from another order', () => {
  expect(computeOrderBalanceFromReceipts({ amount: 5000, receipts: [{ usd: 1000, status: 'SR_Received' }],
    paymentAllocations: [{ amount: 3000, funding: { active: true, receipt: { status: 'Bank_Transfer' } } }],
  })).toBe(1000);
});
it('excludes pending signatures and deleted/inactive funding', () => {
  expect(computeOrderBalanceFromReceipts({ amount: 500,
    paymentAllocations: [
      { amount: 100, funding: { active: true, receipt: { status: 'SIGNING_PENDING' } } },
      { amount: 100, funding: { active: false, receipt: { status: 'RECEIVED' } } },
      { amount: 100, funding: { active: true, receipt: null } },
    ],
  })).toBe(500);
});
