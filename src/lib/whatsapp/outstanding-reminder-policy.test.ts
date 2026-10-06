import { evaluateOutstandingReminder, type ReminderHistory } from './outstanding-reminder-policy';
import type { DashboardCustomerOutstandingOrder } from '@/lib/dashboard-customer-outstanding';

const now = new Date('2026-10-06T07:00:00Z');
const day = 86_400_000;
function order(age: number, outstanding = 100, id = 'old'): DashboardCustomerOutstandingOrder {
  return { orderId: id, orderNo: id, invNo: 'INV', outstanding, statusGroup: 'RELEASED',
    releaseDate: new Date(now.getTime() - age * day).toISOString(), daysSinceRelease: age };
}
const evaluate = (orders: DashboardCustomerOutstandingOrder[], history: ReminderHistory | null = null, date = now) =>
  evaluateOutstandingReminder({ orders, history, now: date });

describe('customer outstanding reminder schedule', () => {
  it.each([[29, null], [30, 30], [59, 30], [60, 60], [119, 60], [120, 120], [179, 120], [180, 180], [300, 180]])(
    'selects just the current stage for age %s', (age, stage) => expect(evaluate([order(age)])?.stage ?? null).toBe(stage),
  );
  it('uses the oldest eligible released order, not the largest balance', () => {
    expect(evaluate([order(200, 20), order(80, 21, 'eligible'), order(40, 9000, 'new')])?.anchor.orderId).toBe('eligible');
    expect(evaluate([{ ...order(200), statusGroup: 'IN_TRANSIT', releaseDate: null }])).toBeNull();
    expect(evaluate([order(200, -1), order(200, 0), order(200, 20)])).toBeNull();
  });
  it('does not run before 07:00 Guinea time', () => {
    expect(evaluate([order(90)], null, new Date('2026-10-06T06:59:59Z'))).toBeNull();
  });
  it('sends the gentle reminder only once in a continuous customer debt episode', () => {
    expect(evaluate([order(45)], { anchorId: 'old', stage: 30, sentAt: new Date(now.getTime() - 15 * day) })).toBeNull();
  });
  it.each([[60, 14], [120, 7], [180, 3]])('enforces the %s-day stage interval', (stage, interval) => {
    expect(evaluate([order(stage + 20)], { anchorId: 'old', stage, sentAt: new Date(now.getTime() - (interval - 1) * day) })).toBeNull();
    expect(evaluate([order(stage + 20)], { anchorId: 'old', stage, sentAt: new Date(now.getTime() - interval * day) })?.stage).toBe(stage);
  });
  it('escalates the same anchor at stage boundaries instead of waiting for its old interval', () => {
    expect(evaluate([order(120)], { anchorId: 'old', stage: 60, sentAt: new Date(now.getTime() - 4 * day) })?.stage).toBe(120);
  });
  it('does not escalate immediately when the anchor changes', () => {
    expect(evaluate([order(180, 100, 'next')], { anchorId: 'old', stage: 120, sentAt: new Date(now.getTime() - 2 * day) })).toBeNull();
    expect(evaluate([order(180, 100, 'next')], { anchorId: 'old', stage: 120, sentAt: new Date(now.getTime() - 3 * day) })?.stage).toBe(180);
  });
  it('prevents two reminders on the same Guinea calendar day', () => {
    expect(evaluate([order(180)], { anchorId: 'old', stage: 120, sentAt: new Date('2026-10-06T01:00:00Z') })).toBeNull();
  });
});
