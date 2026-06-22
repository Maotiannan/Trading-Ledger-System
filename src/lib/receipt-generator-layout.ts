import { formatCustomerPayerLabel } from '@/lib/customer-display';
import { formatUsdAmount } from '@/lib/display-format';

export const RECEIPT_GENERATOR_RECEIVED_BY = 'Mamadou Dian Diallo';
export const RECEIPT_GENERATOR_BANK_RECEIVED_BY = 'Transferred via bank account';
export const RECEIPT_GENERATOR_PAYMENT_TYPES = ['Deposit', 'Full', 'Initial', 'Standard', 'Final'] as const;
export const RECEIPT_GENERATOR_PAYMENT_MODES = ['Espèces', 'Virement'] as const;
export const RECEIPT_GENERATOR_FRAIS_STATUSES = ['Payé', 'Non payé'] as const;
export type ReceiptGeneratorPaymentType = typeof RECEIPT_GENERATOR_PAYMENT_TYPES[number];
export type ReceiptGeneratorPaymentMode = typeof RECEIPT_GENERATOR_PAYMENT_MODES[number];
export type ReceiptGeneratorFraisStatus = typeof RECEIPT_GENERATOR_FRAIS_STATUSES[number];
export type ReceiptGeneratorReceivedBy = typeof RECEIPT_GENERATOR_RECEIVED_BY | typeof RECEIPT_GENERATOR_BANK_RECEIVED_BY;

type ReceiptGeneratorLayoutInput = {
  receiptNo: string;
  orderNo: string;
  invNo: string | null;
  customerMark: string | null;
  customerCompanyName?: string | null;
  customerName: string | null;
  clientTel: string | null;
  usdAmount: number;
  balanceBefore: number | null;
  paymentMode?: ReceiptGeneratorPaymentMode | null;
  fraisStatus?: ReceiptGeneratorFraisStatus | null;
  paymentType?: ReceiptGeneratorPaymentType | null;
  receivedBy?: string | null;
  generatedAt?: Date;
};

export type ReceiptGeneratorLayoutData = {
  receiptNo: string;
  dateText: string;
  orderNo: string;
  invNo: string | null;
  customerMark: string | null;
  customerCompanyName: string | null;
  customerName: string | null;
  clientName: string;
  clientTel: string | null;
  usdAmount: number;
  amountInWords: string;
  motif: string;
  balanceBefore: number | null;
  balanceAfter: number | null;
  resteAPayer: string;
  paymentMode: ReceiptGeneratorPaymentMode;
  fraisStatus: ReceiptGeneratorFraisStatus;
  paymentType: ReceiptGeneratorPaymentType;
  receivedBy: string;
};

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];

const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
];

function formatGeneratorDate(date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return formatter.format(date);
}

function toWordsBelowThousand(value: number): string {
  if (value < 20) return ONES[value];
  if (value < 100) {
    const ten = Math.floor(value / 10);
    const rest = value % 10;
    return rest === 0 ? TENS[ten] : `${TENS[ten]}-${ONES[rest]}`;
  }

  const hundred = Math.floor(value / 100);
  const rest = value % 100;
  return rest === 0
    ? `${ONES[hundred]} hundred`
    : `${ONES[hundred]} hundred ${toWordsBelowThousand(rest)}`;
}

function toEnglishWords(value: number): string {
  if (!Number.isFinite(value) || value < 0) return 'invalid amount';
  if (value === 0) return 'zero';

  const parts: string[] = [];
  const millions = Math.floor(value / 1_000_000);
  const thousands = Math.floor((value % 1_000_000) / 1_000);
  const remainder = value % 1_000;

  if (millions > 0) parts.push(`${toWordsBelowThousand(millions)} million`);
  if (thousands > 0) parts.push(`${toWordsBelowThousand(thousands)} thousand`);
  if (remainder > 0) parts.push(toWordsBelowThousand(remainder));

  return parts.join(' ');
}

export function amountToWordsUsd(value: number): string {
  const normalized = Number.isFinite(value) ? Number(value) : 0;
  const whole = Math.round(normalized);
  const wholeWords = toEnglishWords(whole);
  return `${wholeWords.charAt(0).toUpperCase()}${wholeWords.slice(1)} US dollars only`;
}

function formatMoney(value: number | null): string {
  return formatUsdAmount(value);
}

export function normalizeReceiptGeneratorPaymentType(value: unknown): ReceiptGeneratorPaymentType {
  return RECEIPT_GENERATOR_PAYMENT_TYPES.includes(value as ReceiptGeneratorPaymentType)
    ? value as ReceiptGeneratorPaymentType
    : 'Standard';
}

export function normalizeReceiptGeneratorPaymentMode(value: unknown): ReceiptGeneratorPaymentMode {
  if (value === 'Virement' || value === 'Transfer') return 'Virement';
  return 'Espèces';
}

export function normalizeReceiptGeneratorFraisStatus(value: unknown): ReceiptGeneratorFraisStatus {
  return value === 'Non payé' ? 'Non payé' : 'Payé';
}

export function normalizeReceiptGeneratorReceivedBy(value: unknown): ReceiptGeneratorReceivedBy {
  return value === RECEIPT_GENERATOR_BANK_RECEIVED_BY
    ? RECEIPT_GENERATOR_BANK_RECEIVED_BY
    : RECEIPT_GENERATOR_RECEIVED_BY;
}

function buildPaymentReference(invNo: string | null, orderNo: string) {
  return [invNo, orderNo].filter(Boolean).join(' ').trim();
}

function buildMotif(paymentType: ReceiptGeneratorPaymentType, invNo: string | null, orderNo: string) {
  if (paymentType === 'Deposit') {
    return `Deposit for ${orderNo}`.trim();
  }

  const reference = buildPaymentReference(invNo, orderNo);
  if (paymentType === 'Full') return `Full payment for ${reference}`.trim();
  if (paymentType === 'Initial') return `Initial payment for ${reference}`.trim();
  if (paymentType === 'Final') return `Final payment for ${reference}`.trim();
  return `Payment for ${reference}`.trim();
}

export function buildReceiptGeneratorLayout(input: ReceiptGeneratorLayoutInput): ReceiptGeneratorLayoutData {
  const now = input.generatedAt || new Date();
  const paymentType = normalizeReceiptGeneratorPaymentType(input.paymentType);
  const paymentMode = normalizeReceiptGeneratorPaymentMode(input.paymentMode);
  const fraisStatus = normalizeReceiptGeneratorFraisStatus(input.fraisStatus);
  const receivedBy = normalizeReceiptGeneratorReceivedBy(input.receivedBy);
  const balanceBefore = input.balanceBefore === null ? null : Number(input.balanceBefore);
  const isDeposit = paymentType === 'Deposit';
  const balanceAfter = balanceBefore === null || isDeposit ? null : Number((balanceBefore - input.usdAmount).toFixed(2));
  const customerCompanyName = (input.customerCompanyName || '').trim();
  const customerName = (input.customerName || '').trim();
  const customerMark = (input.customerMark || '').trim();
  const clientName = formatCustomerPayerLabel({
    companyName: customerCompanyName,
    name: customerName,
    mark: customerMark,
  }, { fallbackToMark: true }) || '-';
  const motif = buildMotif(paymentType, input.invNo, input.orderNo);
  const resteAPayer = isDeposit
    ? ''
    : balanceBefore === null || balanceAfter === null
      ? '-'
      : `${formatMoney(balanceBefore)} - ${formatMoney(Number(input.usdAmount))} = ${formatMoney(balanceAfter)}`;

  return {
    receiptNo: input.receiptNo,
    dateText: formatGeneratorDate(now),
    orderNo: input.orderNo,
    invNo: input.invNo,
    customerMark: input.customerMark,
    customerCompanyName: input.customerCompanyName || null,
    customerName: input.customerName,
    clientName,
    clientTel: input.clientTel,
    usdAmount: Number(input.usdAmount),
    amountInWords: amountToWordsUsd(Number(input.usdAmount)),
    motif,
    balanceBefore,
    balanceAfter,
    resteAPayer,
    paymentMode,
    fraisStatus,
    paymentType,
    receivedBy,
  };
}
