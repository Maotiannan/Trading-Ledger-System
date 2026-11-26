import { checkedApprovalPatch } from './approval-baseline';

const preserve = <T,>(record: T) => record;

it('preserves fields absent from a legacy request and ignores non-editable fields', () => {
  const current = { date: '2026-01-02', agentId: 'current-agent' };
  expect(checkedApprovalPatch(current, { date: current.date }, { date: '2026-01-03', status: 'ignored' }, preserve))
    .toEqual({ date: '2026-01-03', agentId: 'current-agent' });
});

it('compares detail rows independently of database order, without discarding duplicates', () => {
  const a = { orderNo: 'A', amount: 20 }, b = { orderNo: 'B', amount: 30 };
  const current = { items: [a, a, b] }, requested = { items: [a, b] };
  expect(checkedApprovalPatch(current, { items: [b, a, a] }, requested, preserve)).toEqual(requested);
  expect(() => checkedApprovalPatch(current, { items: [b, a] }, requested, preserve))
    .toThrow(expect.objectContaining({ status: 409, detail: { fields: [
      { field: 'items', known: true, before: [b, a], requested: [a, b], current: current.items },
    ] } }));
});
