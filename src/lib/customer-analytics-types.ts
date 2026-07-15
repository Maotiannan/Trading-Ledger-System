export type CustomerAnalyticsMetric = 'annual-amount' | 'payment-capacity' | 'payment-cycle';

export type CustomerAnalyticsRiskBandId =
  | 'normal'
  | 'mild-delay'
  | 'some-delay'
  | 'delayed'
  | 'warning'
  | 'double-warning'
  | 'severe-warning';

export type CustomerAnalyticsSettings = {
  lookbackMonths: number;
  normalDays: number;
  mildDelayDays: number;
  delayDays: number;
  warningDays: number;
  doubleWarningDays: number;
  severeWarningDays: number;
};

export type CustomerAnalyticsPeriod = {
  start: Date;
  endExclusive: Date;
};

export type CustomerAnalyticsRiskBand = {
  id: CustomerAnalyticsRiskBandId;
  minDays: number;
  maxDays: number | null;
  zh: string;
  en: string;
};

export type CustomerAnalyticsMoneyInput = string | number | { toString(): string };

export type CustomerAnalyticsCustomerInput = {
  id: string;
  companyName: string | null;
  name: string;
  mark: string;
};

export type CustomerAnalyticsReceiptInput = {
  id: string;
  usd: CustomerAnalyticsMoneyInput;
  status: string;
  date: Date | null;
  createdAt: Date;
  isDeposit: boolean;
};

export type CustomerAnalyticsOrderInput = {
  id: string;
  customerId: string | null;
  orderNo: string;
  invNo: string;
  releaseDate: Date | null;
  amount: CustomerAnalyticsMoneyInput;
  receipts: CustomerAnalyticsReceiptInput[];
};

export type CustomerAnalyticsQuality = {
  missingReleaseDateOrders: number;
  missingReleaseDateAmount: number;
  receiptDateFallbacks: number;
  unboundReceipts: number;
  invalidOrderAmounts: number;
  invalidReceiptAmounts: number;
  futureDatedReceipts: number;
};

export type CustomerAnalyticsRankingRow = {
  rank: number;
  customerId: string;
  customerName: string;
  mark: string;
  value: number;
  rawValue?: number;
  roundedDays?: number;
  riskBand?: CustomerAnalyticsRiskBand;
  overdueOutstanding?: number;
};

export type CustomerAnalyticsAnnualOrderDetail = {
  orderId: string;
  orderNo: string;
  invNo: string;
  releaseDate: Date;
  amount: number;
};

export type CustomerAnalyticsAnnualDetail = {
  customerId: string;
  total: number;
  orders: CustomerAnalyticsAnnualOrderDetail[];
};

export type CustomerAnalyticsAnnualResult = {
  period: CustomerAnalyticsPeriod;
  availableYears: number[];
  items: CustomerAnalyticsRankingRow[];
  detailsByCustomer: Record<string, CustomerAnalyticsAnnualDetail>;
  quality: CustomerAnalyticsQuality;
};

export type CustomerAnalyticsCapacityReceiptDetail = {
  receiptId: string;
  orderId: string;
  orderNo: string;
  amount: number;
  effectiveDate: Date;
  usedDateFallback: boolean;
  isDeposit: boolean;
};

export type CustomerAnalyticsCapacityMonthDetail = {
  month: string;
  total: number;
  receipts: CustomerAnalyticsCapacityReceiptDetail[];
};

export type CustomerAnalyticsCapacityDetail = {
  customerId: string;
  total: number;
  averageMonthly: number;
  months: CustomerAnalyticsCapacityMonthDetail[];
};

export type CustomerAnalyticsCapacityResult = {
  period: CustomerAnalyticsPeriod;
  items: CustomerAnalyticsRankingRow[];
  detailsByCustomer: Record<string, CustomerAnalyticsCapacityDetail>;
  quality: CustomerAnalyticsQuality;
};

export type CustomerAnalyticsCycleOrderDetail = {
  orderId: string;
  orderNo: string;
  invNo: string;
  releaseDate: Date;
  amount: number;
  paidAmount: number;
  outstanding: number;
  rawDays: number;
  roundedDays: number;
  riskBand: CustomerAnalyticsRiskBand;
};

export type CustomerAnalyticsCycleDetail = {
  customerId: string;
  rawDays: number;
  roundedDays: number;
  eligibleOrderCount: number;
  eligibleAmount: number;
  paidAmount: number;
  overdueOutstanding: number;
  withinTermsOutstanding: number;
  orders: CustomerAnalyticsCycleOrderDetail[];
};

export type CustomerAnalyticsCycleResult = {
  period: CustomerAnalyticsPeriod;
  items: CustomerAnalyticsRankingRow[];
  detailsByCustomer: Record<string, CustomerAnalyticsCycleDetail>;
  quality: CustomerAnalyticsQuality;
};
