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

