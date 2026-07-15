import { APP_TIME_ZONE } from '@/lib/app-time';
import type {
  CustomerAnalyticsPeriod,
  CustomerAnalyticsRiskBand,
  CustomerAnalyticsSettings,
} from '@/lib/customer-analytics-types';

const DAY_MS = 86_400_000;
const appDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function getAppDateParts(value: Date): { year: number; month: number; day: number } {
  if (Number.isNaN(value.getTime())) throw new Error('Analytics date must be valid');
  const parts = appDateFormatter.formatToParts(value);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  if (![year, month, day].every(Number.isInteger)) throw new Error('Analytics date parts are invalid');
  return { year, month, day };
}

function appCalendarStamp(value: Date): number {
  const { year, month, day } = getAppDateParts(value);
  return Date.UTC(year, month - 1, day);
}

export function getCompletedMonthWindow(asOf: Date, months: number): CustomerAnalyticsPeriod {
  if (!Number.isInteger(months) || months < 1) throw new Error('Completed-month lookback must be a positive integer');
  const { year, month } = getAppDateParts(asOf);
  const endExclusive = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(endExclusive);
  start.setUTCMonth(start.getUTCMonth() - months);
  return { start, endExclusive };
}

export function getNaturalYearWindow(year: number): CustomerAnalyticsPeriod {
  if (!Number.isInteger(year) || year < 1) throw new Error('Analytics year must be a positive integer');
  return {
    start: new Date(Date.UTC(year, 0, 1)),
    endExclusive: new Date(Date.UTC(year + 1, 0, 1)),
  };
}

export function appCalendarDaysBetween(start: Date, end: Date): number {
  return Math.round((appCalendarStamp(end) - appCalendarStamp(start)) / DAY_MS);
}

export function classifyCustomerRisk(
  days: number,
  settings: CustomerAnalyticsSettings,
): CustomerAnalyticsRiskBand {
  if (!Number.isFinite(days)) throw new Error('Payment-cycle days must be finite');
  const roundedDays = Math.max(0, Math.round(days));

  if (roundedDays <= settings.normalDays) {
    return { id: 'normal', minDays: 0, maxDays: settings.normalDays, zh: '正常', en: 'Normal' };
  }
  if (roundedDays < settings.mildDelayDays) {
    return {
      id: 'mild-delay',
      minDays: settings.normalDays + 1,
      maxDays: settings.mildDelayDays - 1,
      zh: '轻微拖延',
      en: 'Mild delay',
    };
  }
  if (roundedDays < settings.delayDays) {
    return {
      id: 'some-delay',
      minDays: settings.mildDelayDays,
      maxDays: settings.delayDays - 1,
      zh: '有点拖延',
      en: 'Some delay',
    };
  }
  if (roundedDays < settings.warningDays) {
    return {
      id: 'delayed',
      minDays: settings.delayDays,
      maxDays: settings.warningDays - 1,
      zh: '拖延',
      en: 'Delayed',
    };
  }
  if (roundedDays < settings.doubleWarningDays) {
    return {
      id: 'warning',
      minDays: settings.warningDays,
      maxDays: settings.doubleWarningDays - 1,
      zh: '警告',
      en: 'Warning',
    };
  }
  if (roundedDays < settings.severeWarningDays) {
    return {
      id: 'double-warning',
      minDays: settings.doubleWarningDays,
      maxDays: settings.severeWarningDays - 1,
      zh: '加倍警告',
      en: 'Double warning',
    };
  }
  return {
    id: 'severe-warning',
    minDays: settings.severeWarningDays,
    maxDays: null,
    zh: '严重警告',
    en: 'Severe warning',
  };
}
