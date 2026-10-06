import type { DashboardCustomerOutstandingOrder } from '@/lib/dashboard-customer-outstanding';

const DAY_MS = 86_400_000;
export const OUTSTANDING_REMINDER_POLICY = {
  minimumBalance: 20,
  hourUtc: 7, // Africa/Conakry uses UTC year-round.
  stages: [{ day: 180, interval: 3 }, { day: 120, interval: 7 }, { day: 60, interval: 14 }, { day: 30, interval: null }],
} as const;

export type ReminderHistory = { anchorId: string; stage: number; sentAt: Date };

export function evaluateOutstandingReminder(input: {
  orders: DashboardCustomerOutstandingOrder[];
  history: ReminderHistory | null;
  now: Date;
  checkSchedule?: boolean;
}) {
  const { now, history } = input;
  if (input.checkSchedule !== false && now.getUTCHours() < OUTSTANDING_REMINDER_POLICY.hourUtc) return null;
  const eligible = input.orders.filter(order => order.statusGroup === 'RELEASED'
    && order.outstanding > OUTSTANDING_REMINDER_POLICY.minimumBalance
    && order.releaseDate && Number.isFinite(Date.parse(order.releaseDate)))
    .sort((a, b) => Date.parse(a.releaseDate!) - Date.parse(b.releaseDate!) || a.orderId.localeCompare(b.orderId));
  const anchor = eligible[0];
  if (!anchor) return null;
  const age = Math.floor((now.getTime() - Date.parse(anchor.releaseDate!)) / DAY_MS);
  const stage = OUTSTANDING_REMINDER_POLICY.stages.find(item => age >= item.day);
  if (!stage) return null;
  if (history) {
    if (history.sentAt.toISOString().slice(0, 10) >= now.toISOString().slice(0, 10)) return null;
    const escalatingSameAnchor = history.anchorId === anchor.orderId && stage.day > history.stage;
    if (!escalatingSameAnchor) {
      if (stage.interval === null) return null;
      const elapsedDays = Math.floor(now.getTime() / DAY_MS) - Math.floor(history.sentAt.getTime() / DAY_MS);
      if (elapsedDays < stage.interval) return null;
    }
  }
  return { anchor, stage: stage.day, interval: stage.interval, age, dateKey: now.toISOString().slice(0, 10) };
}
