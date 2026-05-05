export const RECEIPT_GENERATOR_RECEIVED_BY = 'Mamadou Dian Diallo';

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
  paymentMode?: 'Cash' | 'Transfer' | null;
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
  paymentMode?: 'Cash' | 'Transfer';
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
  const whole = Math.floor(normalized);
  const cents = Math.round((normalized - whole) * 100);
  const wholeWords = toEnglishWords(whole);
  if (cents === 0) {
    return `${wholeWords} US dollars only`;
  }
  return `${wholeWords} US dollars and ${toEnglishWords(cents)} cents`;
}

function formatMoney(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  return `$${Number(value).toFixed(2)}`;
}

export function buildReceiptGeneratorLayout(input: ReceiptGeneratorLayoutInput): ReceiptGeneratorLayoutData {
  const now = input.generatedAt || new Date();
  const balanceBefore = input.balanceBefore === null ? null : Number(input.balanceBefore);
  const balanceAfter = balanceBefore === null ? null : Number((balanceBefore - input.usdAmount).toFixed(2));
  const customerCompanyName = (input.customerCompanyName || '').trim();
  const customerName = (input.customerName || '').trim();
  const customerMark = (input.customerMark || '').trim();
  const displayName = customerCompanyName || customerName;
  const clientName = displayName && customerMark
    ? `${displayName} "${customerMark}"`
    : displayName || customerMark || '-';
  const motifParts = ['Payment for'];
  if (input.invNo) motifParts.push(input.invNo);
  motifParts.push(input.orderNo);

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
    motif: motifParts.join(' ').trim(),
    balanceBefore,
    balanceAfter,
    resteAPayer: balanceBefore === null || balanceAfter === null
      ? '-'
      : `${formatMoney(balanceBefore)} - ${formatMoney(Number(input.usdAmount))} = ${formatMoney(balanceAfter)}`,
    paymentMode: input.paymentMode === 'Transfer' ? 'Transfer' : 'Cash',
    receivedBy: RECEIPT_GENERATOR_RECEIVED_BY,
  };
}
