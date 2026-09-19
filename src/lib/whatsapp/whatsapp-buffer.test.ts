/** @jest-environment node */
import { bufferDeadline, computeReceiptBalanceAfter, pendingDeliveryUpdate } from './whatsapp-buffer';
const now = new Date('2026-09-19T00:00:00Z');
it('waits five minutes from the latest material change', () => {
  expect(bufferDeadline(now).toISOString()).toBe('2026-09-19T00:05:00.000Z');
  expect(pendingDeliveryUpdate({ paused: false, changed: true, wasPaused: false, requiresApproval: false }, now)).toMatchObject({ status: 'QUEUED', nextSendAt: bufferDeadline(now), approvedAt: null });
});
it('does not reset time for unchanged content', () => {
  expect(pendingDeliveryUpdate({ paused: false, changed: false, wasPaused: false, requiresApproval: true }, now)).toEqual({});
});
it('pauses for deletion and requires a new approval and buffer after rejection', () => {
  expect(pendingDeliveryUpdate({ paused: true, changed: false, wasPaused: false, requiresApproval: true }, now)).toMatchObject({ status: 'PAUSED', approvedAt: null });
  expect(pendingDeliveryUpdate({ paused: false, changed: false, wasPaused: true, requiresApproval: true }, now)).toMatchObject({ status: 'PENDING', nextSendAt: bufferDeadline(now) });
});
it('uses the same financial formula but excludes later receipts and signing drafts', () => {
  const a = { id: 'a', createdAt: now, usd: 2000, status: 'RECEIVED' };
  const b = { id: 'b', createdAt: new Date(now.getTime() + 1), usd: 3000, status: 'SR_Received' };
  const draft = { id: '0', createdAt: now, usd: 999, status: 'SIGNING_PENDING' };
  expect(computeReceiptBalanceAfter({ amount: 10000, receipts: [a, b, draft] }, a)).toBe(8000);
  expect(computeReceiptBalanceAfter({ amount: 10000, receipts: [a, b, draft] }, b)).toBe(5000);
  expect(computeReceiptBalanceAfter({ amount: 10000, receipts: [b, draft] }, b)).toBe(7000);
});
