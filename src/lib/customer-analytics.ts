import { Prisma } from '@prisma/client';
import { APP_TIME_ZONE } from '@/lib/app-time';
import { isReceiptIncludedInOrderBalance } from '@/lib/order-balance';
import { moneyToNumber, toDecimal } from '@/lib/money';
import type {
  CustomerAnalyticsAnnualDetail,
  CustomerAnalyticsAnnualResult,
  CustomerAnalyticsCapacityDetail,
  CustomerAnalyticsCapacityReceiptDetail,
  CustomerAnalyticsCapacityResult,
  CustomerAnalyticsCustomerInput,
  CustomerAnalyticsCycleDetail,
  CustomerAnalyticsCycleOrderDetail,
  CustomerAnalyticsCycleResult,
  CustomerAnalyticsOrderInput,
  CustomerAnalyticsPeriod,
  CustomerAnalyticsQuality,
  CustomerAnalyticsRankingRow,
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

function appMonthKey(value: Date): string {
  const { year, month } = getAppDateParts(value);
  return `${year}-${String(month).padStart(2, '0')}`;
}

function emptyQuality(): CustomerAnalyticsQuality {
  return {
    missingReleaseDateOrders: 0,
    missingReleaseDateAmount: 0,
    receiptDateFallbacks: 0,
    unboundReceipts: 0,
    invalidOrderAmounts: 0,
    invalidReceiptAmounts: 0,
    futureDatedReceipts: 0,
  };
}

function isNormalInvoice(invNo: string): boolean {
  const normalized = invNo.trim().toUpperCase();
  return normalized !== 'DEPOSIT_POOL' && normalized !== 'UN_ASSOCIATED';
}

function customerDisplayName(customer: CustomerAnalyticsCustomerInput): string {
  return customer.companyName?.trim() || customer.name.trim() || customer.mark.trim() || '-';
}

function compareCustomerRows(
  left: Pick<CustomerAnalyticsRankingRow, 'customerName' | 'customerId'>,
  right: Pick<CustomerAnalyticsRankingRow, 'customerName' | 'customerId'>,
): number {
  return left.customerName.localeCompare(right.customerName, 'en', { sensitivity: 'base' })
    || left.customerId.localeCompare(right.customerId);
}

function isInsidePeriod(value: Date, period: CustomerAnalyticsPeriod): boolean {
  return value >= period.start && value < period.endExclusive;
}

function buildMonthKeys(period: CustomerAnalyticsPeriod, count: number): string[] {
  const keys: string[] = [];
  const cursor = new Date(period.start);
  for (let index = 0; index < count; index += 1) {
    keys.push(appMonthKey(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
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

export function calculateAnnualAmountRanking(input: {
  customers: CustomerAnalyticsCustomerInput[];
  orders: CustomerAnalyticsOrderInput[];
  year: number;
}): CustomerAnalyticsAnnualResult {
  const period = getNaturalYearWindow(input.year);
  const quality = emptyQuality();
  const customers = new Map(input.customers.map((customer) => [customer.id, customer]));
  const totals = new Map<string, Prisma.Decimal>();
  const detailsByCustomer: Record<string, CustomerAnalyticsAnnualDetail> = {};
  const availableYears = new Set<number>();
  let missingReleaseAmount = new Prisma.Decimal(0);

  for (const order of input.orders) {
    if (!isNormalInvoice(order.invNo)) continue;
    const amount = toDecimal(order.amount);
    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      quality.invalidOrderAmounts += 1;
      continue;
    }
    if (!order.releaseDate) {
      quality.missingReleaseDateOrders += 1;
      missingReleaseAmount = missingReleaseAmount.plus(amount);
      continue;
    }

    availableYears.add(getAppDateParts(order.releaseDate).year);
    if (!isInsidePeriod(order.releaseDate, period) || !order.customerId) continue;
    const customer = customers.get(order.customerId);
    if (!customer) continue;

    totals.set(customer.id, (totals.get(customer.id) || new Prisma.Decimal(0)).plus(amount));
    const detail = detailsByCustomer[customer.id] || {
      customerId: customer.id,
      total: 0,
      orders: [],
    };
    detail.orders.push({
      orderId: order.id,
      orderNo: order.orderNo,
      invNo: order.invNo,
      releaseDate: order.releaseDate,
      amount: moneyToNumber(amount),
    });
    detailsByCustomer[customer.id] = detail;
  }

  quality.missingReleaseDateAmount = moneyToNumber(missingReleaseAmount);
  const items = Array.from(totals.entries())
    .map(([customerId, total]) => {
      const customer = customers.get(customerId)!;
      const value = moneyToNumber(total);
      detailsByCustomer[customerId].total = value;
      detailsByCustomer[customerId].orders.sort((left, right) => (
        right.releaseDate.getTime() - left.releaseDate.getTime()
        || left.orderNo.localeCompare(right.orderNo)
      ));
      return {
        rank: 0,
        customerId,
        customerName: customerDisplayName(customer),
        mark: customer.mark,
        value,
      } satisfies CustomerAnalyticsRankingRow;
    })
    .sort((left, right) => right.value - left.value || compareCustomerRows(left, right))
    .map((row, index) => ({ ...row, rank: index + 1 }));

  return {
    period,
    availableYears: Array.from(availableYears).sort((left, right) => left - right),
    items,
    detailsByCustomer,
    quality,
  };
}

export function calculatePaymentCapacityRanking(input: {
  customers: CustomerAnalyticsCustomerInput[];
  orders: CustomerAnalyticsOrderInput[];
  asOf: Date;
  settings: CustomerAnalyticsSettings;
}): CustomerAnalyticsCapacityResult {
  const period = getCompletedMonthWindow(input.asOf, input.settings.lookbackMonths);
  const monthKeys = buildMonthKeys(period, input.settings.lookbackMonths);
  const quality = emptyQuality();
  const customers = new Map(input.customers.map((customer) => [customer.id, customer]));
  const seenReceiptIds = new Set<string>();
  const accumulators = new Map<string, {
    total: Prisma.Decimal;
    months: Map<string, { total: Prisma.Decimal; receipts: CustomerAnalyticsCapacityReceiptDetail[] }>;
  }>();

  for (const customer of input.customers) {
    accumulators.set(customer.id, {
      total: new Prisma.Decimal(0),
      months: new Map(monthKeys.map((month) => [month, { total: new Prisma.Decimal(0), receipts: [] }])),
    });
  }

  for (const order of input.orders) {
    if (!order.customerId || !customers.has(order.customerId)) continue;
    const customerAccumulator = accumulators.get(order.customerId)!;
    for (const receipt of order.receipts) {
      if (seenReceiptIds.has(receipt.id)) continue;
      seenReceiptIds.add(receipt.id);
      if (!isReceiptIncludedInOrderBalance(receipt.status)) continue;

      const amount = toDecimal(receipt.usd);
      if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
        quality.invalidReceiptAmounts += 1;
        continue;
      }

      const usedDateFallback = !receipt.date;
      const effectiveDate = receipt.date || receipt.createdAt;
      if (usedDateFallback) quality.receiptDateFallbacks += 1;
      if (effectiveDate > input.asOf) {
        quality.futureDatedReceipts += 1;
        continue;
      }
      if (!isInsidePeriod(effectiveDate, period)) continue;

      const month = appMonthKey(effectiveDate);
      const monthAccumulator = customerAccumulator.months.get(month);
      if (!monthAccumulator) continue;
      customerAccumulator.total = customerAccumulator.total.plus(amount);
      monthAccumulator.total = monthAccumulator.total.plus(amount);
      monthAccumulator.receipts.push({
        receiptId: receipt.id,
        orderId: order.id,
        orderNo: order.orderNo,
        amount: moneyToNumber(amount),
        effectiveDate,
        usedDateFallback,
        isDeposit: receipt.isDeposit,
      });
    }
  }

  const detailsByCustomer: Record<string, CustomerAnalyticsCapacityDetail> = {};
  const items = input.customers.map((customer) => {
    const accumulator = accumulators.get(customer.id)!;
    const total = moneyToNumber(accumulator.total);
    const averageMonthly = moneyToNumber(accumulator.total.div(input.settings.lookbackMonths));
    detailsByCustomer[customer.id] = {
      customerId: customer.id,
      total,
      averageMonthly,
      months: monthKeys.map((month) => {
        const row = accumulator.months.get(month)!;
        return {
          month,
          total: moneyToNumber(row.total),
          receipts: row.receipts.slice().sort((left, right) => (
            left.effectiveDate.getTime() - right.effectiveDate.getTime()
            || left.receiptId.localeCompare(right.receiptId)
          )),
        };
      }),
    };
    return {
      rank: 0,
      customerId: customer.id,
      customerName: customerDisplayName(customer),
      mark: customer.mark,
      value: averageMonthly,
    } satisfies CustomerAnalyticsRankingRow;
  })
    .sort((left, right) => right.value - left.value || compareCustomerRows(left, right))
    .map((row, index) => ({ ...row, rank: index + 1 }));

  return { period, items, detailsByCustomer, quality };
}

type NormalizedCyclePayment = {
  id: string;
  amount: Prisma.Decimal;
  effectiveDate: Date;
};

function normalizeCyclePayments(
  order: CustomerAnalyticsOrderInput,
  asOf: Date,
  seenReceiptIds: Set<string>,
  quality: CustomerAnalyticsQuality,
): NormalizedCyclePayment[] {
  const payments: NormalizedCyclePayment[] = [];
  for (const receipt of order.receipts) {
    if (seenReceiptIds.has(receipt.id)) continue;
    seenReceiptIds.add(receipt.id);
    if (!isReceiptIncludedInOrderBalance(receipt.status)) continue;

    const amount = toDecimal(receipt.usd);
    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      quality.invalidReceiptAmounts += 1;
      continue;
    }

    const effectiveDate = receipt.date || receipt.createdAt;
    if (!receipt.date) quality.receiptDateFallbacks += 1;
    if (effectiveDate > asOf) {
      quality.futureDatedReceipts += 1;
      continue;
    }
    payments.push({ id: receipt.id, amount, effectiveDate });
  }
  return payments.sort((left, right) => (
    left.effectiveDate.getTime() - right.effectiveDate.getTime()
    || left.id.localeCompare(right.id)
  ));
}

function calculateOrderPaymentTimeline(input: {
  amount: Prisma.Decimal;
  releaseDate: Date;
  asOf: Date;
  payments: NormalizedCyclePayment[];
}): {
  dollarDays: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  outstanding: Prisma.Decimal;
  rawDays: number;
  roundedDays: number;
} {
  let remaining = input.amount;
  let dollarDays = new Prisma.Decimal(0);

  for (const payment of input.payments) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const allocated = payment.amount.greaterThan(remaining) ? remaining : payment.amount;
    const days = payment.effectiveDate <= input.releaseDate
      ? 0
      : Math.max(0, appCalendarDaysBetween(input.releaseDate, payment.effectiveDate));
    dollarDays = dollarDays.plus(allocated.mul(days));
    remaining = remaining.minus(allocated);
  }

  if (remaining.greaterThan(0)) {
    const ageDays = Math.max(0, appCalendarDaysBetween(input.releaseDate, input.asOf));
    dollarDays = dollarDays.plus(remaining.mul(ageDays));
  }

  const rawDays = Number(dollarDays.div(input.amount).toFixed(6));
  return {
    dollarDays,
    paidAmount: input.amount.minus(remaining),
    outstanding: remaining,
    rawDays,
    roundedDays: Math.round(rawDays),
  };
}

export function calculatePaymentCycleRanking(input: {
  customers: CustomerAnalyticsCustomerInput[];
  orders: CustomerAnalyticsOrderInput[];
  asOf: Date;
  settings: CustomerAnalyticsSettings;
}): CustomerAnalyticsCycleResult {
  const period = getCompletedMonthWindow(input.asOf, input.settings.lookbackMonths);
  const quality = emptyQuality();
  const customers = new Map(input.customers.map((customer) => [customer.id, customer]));
  const seenReceiptIds = new Set<string>();
  const accumulators = new Map<string, {
    amount: Prisma.Decimal;
    dollarDays: Prisma.Decimal;
    paidAmount: Prisma.Decimal;
    overdueOutstanding: Prisma.Decimal;
    withinTermsOutstanding: Prisma.Decimal;
    orders: CustomerAnalyticsCycleOrderDetail[];
  }>();
  let missingReleaseAmount = new Prisma.Decimal(0);

  const getAccumulator = (customerId: string) => {
    const existing = accumulators.get(customerId);
    if (existing) return existing;
    const created = {
      amount: new Prisma.Decimal(0),
      dollarDays: new Prisma.Decimal(0),
      paidAmount: new Prisma.Decimal(0),
      overdueOutstanding: new Prisma.Decimal(0),
      withinTermsOutstanding: new Prisma.Decimal(0),
      orders: [],
    };
    accumulators.set(customerId, created);
    return created;
  };

  for (const order of input.orders) {
    if (!isNormalInvoice(order.invNo) || !order.customerId || !customers.has(order.customerId)) continue;
    const amount = toDecimal(order.amount);
    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      quality.invalidOrderAmounts += 1;
      continue;
    }
    if (!order.releaseDate) {
      quality.missingReleaseDateOrders += 1;
      missingReleaseAmount = missingReleaseAmount.plus(amount);
      continue;
    }

    const ageDays = appCalendarDaysBetween(order.releaseDate, input.asOf);
    if (ageDays < 0) continue;
    const payments = normalizeCyclePayments(order, input.asOf, seenReceiptIds, quality);
    const timeline = calculateOrderPaymentTimeline({
      amount,
      releaseDate: order.releaseDate,
      asOf: input.asOf,
      payments,
    });
    const complete = timeline.outstanding.lessThanOrEqualTo(0);
    const releasedInsideCompletedWindow = isInsidePeriod(order.releaseDate, period);
    const accumulator = getAccumulator(order.customerId);

    if (!complete && ageDays <= input.settings.normalDays) {
      accumulator.withinTermsOutstanding = accumulator.withinTermsOutstanding.plus(timeline.outstanding);
      continue;
    }
    if (complete && !releasedInsideCompletedWindow) continue;

    const riskBand = classifyCustomerRisk(timeline.rawDays, input.settings);
    accumulator.amount = accumulator.amount.plus(amount);
    accumulator.dollarDays = accumulator.dollarDays.plus(timeline.dollarDays);
    accumulator.paidAmount = accumulator.paidAmount.plus(timeline.paidAmount);
    accumulator.overdueOutstanding = accumulator.overdueOutstanding.plus(timeline.outstanding);
    accumulator.orders.push({
      orderId: order.id,
      orderNo: order.orderNo,
      invNo: order.invNo,
      releaseDate: order.releaseDate,
      amount: moneyToNumber(amount),
      paidAmount: moneyToNumber(timeline.paidAmount),
      outstanding: moneyToNumber(timeline.outstanding),
      rawDays: timeline.rawDays,
      roundedDays: timeline.roundedDays,
      riskBand,
    });
  }

  quality.missingReleaseDateAmount = moneyToNumber(missingReleaseAmount);
  const detailsByCustomer: Record<string, CustomerAnalyticsCycleDetail> = {};
  const items: CustomerAnalyticsRankingRow[] = [];

  for (const [customerId, accumulator] of accumulators) {
    if (accumulator.amount.lessThanOrEqualTo(0)) continue;
    const customer = customers.get(customerId)!;
    const rawDays = Number(accumulator.dollarDays.div(accumulator.amount).toFixed(6));
    const roundedDays = Math.round(rawDays);
    const overdueOutstanding = moneyToNumber(accumulator.overdueOutstanding);
    accumulator.orders.sort((left, right) => (
      right.rawDays - left.rawDays
      || right.outstanding - left.outstanding
      || left.orderNo.localeCompare(right.orderNo)
    ));
    detailsByCustomer[customerId] = {
      customerId,
      rawDays,
      roundedDays,
      eligibleOrderCount: accumulator.orders.length,
      eligibleAmount: moneyToNumber(accumulator.amount),
      paidAmount: moneyToNumber(accumulator.paidAmount),
      overdueOutstanding,
      withinTermsOutstanding: moneyToNumber(accumulator.withinTermsOutstanding),
      orders: accumulator.orders,
    };
    items.push({
      rank: 0,
      customerId,
      customerName: customerDisplayName(customer),
      mark: customer.mark,
      value: roundedDays,
      rawValue: rawDays,
      roundedDays,
      riskBand: classifyCustomerRisk(rawDays, input.settings),
      overdueOutstanding,
    });
  }

  items.sort((left, right) => (
    (right.rawValue || 0) - (left.rawValue || 0)
    || (right.overdueOutstanding || 0) - (left.overdueOutstanding || 0)
    || compareCustomerRows(left, right)
  ));

  return {
    period,
    items: items.map((row, index) => ({ ...row, rank: index + 1 })),
    detailsByCustomer,
    quality,
  };
}
