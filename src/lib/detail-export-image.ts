import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { Resvg } from '@resvg/resvg-js';
import { ReceiptStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { formatOrderNameDisplay } from '@/lib/display-format';
import { findOrderIdByNoOrAlias } from '@/lib/order-alias-db';
import {
  classifyPaymentType,
  DEPOSIT_POOL_INVOICE_NO,
  SYSTEM_POOL_INVOICE_NOS,
  type PaymentTypeClassification,
} from '@/lib/payment-type-classifier';

type DetailExportSourceItem = {
  mark: string | null;
  orderNo: string | null;
  amount: number | { toString(): string };
  receipt?: {
    id?: string | null;
    orderNo?: string | null;
    orderId?: string | null;
    isDeposit?: boolean | null;
    createdAt?: string | Date | null;
  } | null;
};

export type DetailExportSource = {
  id: string;
  date: string | Date | null;
  createdAt?: string | Date | null;
  totalAmount?: number | { toString(): string } | null;
  swift?: {
    status?: string | null;
  } | null;
  agent?: {
    companyName?: string | null;
  } | null;
  items: DetailExportSourceItem[];
};

export type DetailExportRow = {
  index: number;
  mark: string;
  orderNo: string;
  type: PaymentTypeClassification;
  amount: number;
};

export type DetailExportViewModel = {
  dateLabel: string;
  totalAmount: number;
  transactionCount: number;
  footerAgentLabel: string;
  rows: DetailExportRow[];
};

const WIDTH = 720;
const SIDE_PADDING = 24;
const TOP_BORDER = 8;
const HEADER_HEIGHT = 92;
const STATS_HEIGHT = 66;
const TABLE_HEADER_HEIGHT = 42;
const ROW_HEIGHT = 42;
const ORDER_LINE_HEIGHT = 16;
const ORDER_MAX_LINE_CHARS = 18;
const FOOTER_HEIGHT = 50;
const FOOTNOTE_HEIGHT = 30;
const BOTTOM_MARGIN = 12;
const LOGO_WIDTH = 245;
const LOGO_HEIGHT = 45;
const COLORS = {
  blue: '#415cc3',
  muted: '#999999',
  lightMuted: '#bbbbbb',
  border: '#eeeeee',
  row: '#f2f2f2',
  pink: '#e84789',
  pinkBg: '#fde8f2',
  indigo: '#415cc3',
  indigoBg: '#eaedfa',
  green: '#128a3a',
  greenBg: '#daf7e4',
} as const;

const TABLE_COLUMNS = {
  index: SIDE_PADDING + 14,
  mark: SIDE_PADDING + 62,
  orderNo: SIDE_PADDING + 230,
  type: SIDE_PADDING + 412,
  amount: WIDTH - SIDE_PADDING - 10,
} as const;

let cachedLogoDataUri: string | null = null;
let cachedFontPaths: string[] | null = null;

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeText(value: string | null | undefined, fallback = '-') {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || fallback;
}

function toNumber(value: number | { toString(): string } | null | undefined) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatAmount(value: number) {
  return Math.round(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function formatSheetDate(date: string | Date | null | undefined) {
  if (!date) return '';
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const year = String(parsed.getFullYear());
  return `${day} / ${month} / ${year}`;
}

function resolveLogoDataUri() {
  if (cachedLogoDataUri) return cachedLogoDataUri;
  const logoPath = path.join(process.cwd(), 'public', 'detail-export', 'payment-detail-logo.png');
  cachedLogoDataUri = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`;
  return cachedLogoDataUri;
}

export function getDetailExportFontPaths() {
  if (cachedFontPaths) return cachedFontPaths;
  cachedFontPaths = [
    path.join(process.cwd(), 'public', 'detail-export', 'arial.ttf'),
    path.join(process.cwd(), 'public', 'detail-export', 'arial-bold.ttf'),
  ];
  return cachedFontPaths;
}

type ResolvedItemAnalysis = {
  orderId: string | null;
  orderBalance: number | null;
  isPoolOrder: boolean;
  isDepositPayment: boolean;
  isFirstPayment: boolean;
};

async function analyzeDetailItems(detail: DetailExportSource): Promise<ResolvedItemAnalysis[]> {
  const resolvedOrderIds = await Promise.all(detail.items.map(async (item) => {
    if (item.receipt?.orderId) return item.receipt.orderId;
    const orderNo = item.orderNo || item.receipt?.orderNo || null;
    if (!orderNo) return null;
    return findOrderIdByNoOrAlias(orderNo);
  }));

  const uniqueOrderIds = Array.from(new Set(resolvedOrderIds.filter((value): value is string => Boolean(value))));
  const orderBalanceMap = new Map<string, number>();
  const poolOrderIds = new Set<string>();
  const depositOrderIds = new Set<string>();
  const earliestReceiptIdMap = new Map<string, string>();

  if (uniqueOrderIds.length > 0) {
    const orderRows = await db.order.findMany({
      where: { id: { in: uniqueOrderIds } },
      select: {
        id: true,
        orderBalance: true,
        invoice: {
          select: { invNo: true },
        },
      },
    });
    for (const row of orderRows) {
      orderBalanceMap.set(row.id, Number(row.orderBalance));
      const invNo = row.invoice?.invNo ?? null;
      if (invNo && SYSTEM_POOL_INVOICE_NOS.has(invNo)) {
        poolOrderIds.add(row.id);
      }
      if (invNo === DEPOSIT_POOL_INVOICE_NO) {
        depositOrderIds.add(row.id);
      }
    }

    const receiptRows = await db.receipt.findMany({
      where: {
        orderId: { in: uniqueOrderIds },
        status: { not: ReceiptStatus.SIGNING_PENDING },
      },
      select: {
        id: true,
        orderId: true,
        createdAt: true,
      },
      orderBy: [
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
    });

    for (const row of receiptRows) {
      if (!row.orderId || earliestReceiptIdMap.has(row.orderId)) continue;
      earliestReceiptIdMap.set(row.orderId, row.id);
    }
  }

  return resolvedOrderIds.map((orderId, index) => {
    const currentReceiptId = detail.items[index]?.receipt?.id || null;
    const earliestReceiptId = orderId ? (earliestReceiptIdMap.get(orderId) ?? null) : null;
    return {
      orderId,
      orderBalance: orderId ? (orderBalanceMap.get(orderId) ?? null) : null,
      isPoolOrder: orderId ? poolOrderIds.has(orderId) : false,
      isDepositPayment: Boolean(detail.items[index]?.receipt?.isDeposit || (orderId && depositOrderIds.has(orderId))),
      isFirstPayment: Boolean(orderId && currentReceiptId && earliestReceiptId && currentReceiptId === earliestReceiptId),
    };
  });
}

export async function buildDetailExportViewModel(detail: DetailExportSource): Promise<DetailExportViewModel> {
  const rowsAnalysis = await analyzeDetailItems(detail);
  const rows = detail.items.map((item, index) => {
    const amount = toNumber(item.amount);
    const analysis = rowsAnalysis[index] ?? {
      orderId: null,
      orderBalance: null,
      isPoolOrder: false,
      isDepositPayment: false,
      isFirstPayment: false,
    };
    return {
      index: index + 1,
      mark: normalizeText(item.mark).toUpperCase(),
      orderNo: formatOrderNameDisplay(item.orderNo || item.receipt?.orderNo),
      type: classifyPaymentType({
        balanceAfter: analysis.orderBalance,
        isPoolOrder: analysis.isPoolOrder,
        isDepositPayment: analysis.isDepositPayment,
        isFirstPayment: analysis.isFirstPayment,
      }),
      amount,
    } satisfies DetailExportRow;
  });

  const totalAmount = detail.totalAmount != null
    ? toNumber(detail.totalAmount)
    : rows.reduce((sum, row) => sum + row.amount, 0);

  return {
    dateLabel: formatSheetDate(detail.date || detail.createdAt),
    totalAmount,
    transactionCount: rows.length,
    footerAgentLabel: normalizeText(detail.agent?.companyName, 'Mitty Group'),
    rows,
  };
}

function wrapTextByColumns(value: string, maxChars: number) {
  const source = value.trim();
  if (!source) return ['-'];

  const tokens = source.match(/[^/\s]+[\/\s]?/g) ?? [source];
  const lines: string[] = [];
  let current = '';

  const pushHardWrapped = (token: string) => {
    let remaining = token;
    while (remaining.length > maxChars) {
      lines.push(remaining.slice(0, maxChars));
      remaining = remaining.slice(maxChars);
    }
    return remaining;
  };

  for (const rawToken of tokens) {
    const token = rawToken;
    if (!token.trim()) continue;

    if (token.length > maxChars) {
      if (current) {
        lines.push(current.trimEnd());
        current = '';
      }
      current = pushHardWrapped(token);
      continue;
    }

    const next = current ? `${current}${token}` : token;
    if (next.length > maxChars && current) {
      lines.push(current.trimEnd());
      current = token;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current.trimEnd());
  return lines.length > 0 ? lines : ['-'];
}

function getOrderLines(row: DetailExportRow) {
  return wrapTextByColumns(row.orderNo, ORDER_MAX_LINE_CHARS);
}

function getRowHeight(row: DetailExportRow) {
  const lineCount = getOrderLines(row).length;
  return Math.max(ROW_HEIGHT, lineCount * ORDER_LINE_HEIGHT + 18);
}

function buildWrappedOrderText(row: DetailExportRow, centerY: number) {
  const lines = getOrderLines(row);
  const firstY = centerY - ((lines.length - 1) * ORDER_LINE_HEIGHT) / 2;
  const tspans = lines.map((line, index) => (
    `<tspan x="${TABLE_COLUMNS.orderNo}" y="${firstY + index * ORDER_LINE_HEIGHT}">${escapeXml(line)}</tspan>`
  )).join('');
  return `<text class="root" x="${TABLE_COLUMNS.orderNo}" y="${centerY}" font-size="13" font-weight="700" fill="#000000" dominant-baseline="middle">${tspans}</text>`;
}

function buildTypeBadge(type: DetailExportRow['type'], x: number, centerY: number) {
  if (type === 'Final' || type === 'Full payment') {
    const label = type === 'Full payment' ? 'Full payment' : 'Final';
    const width = type === 'Full payment' ? 92 : 48;
    return `
      <rect x="${x}" y="${centerY - 10.5}" width="${width}" height="21" rx="4" fill="${COLORS.greenBg}" />
      <text class="root" x="${x + width / 2}" y="${centerY}" font-size="11" font-weight="700" text-anchor="middle" dominant-baseline="middle" fill="${COLORS.green}">${label}</text>
    `;
  }
  if (type === 'Initial' || type === 'Deposit') {
    const label = type === 'Deposit' ? 'Deposit' : 'Initial';
    return `
      <rect x="${x}" y="${centerY - 10.5}" width="56" height="21" rx="4" fill="${COLORS.indigoBg}" />
      <text class="root" x="${x + 28}" y="${centerY}" font-size="11" font-weight="700" text-anchor="middle" dominant-baseline="middle" fill="${COLORS.indigo}">${label}</text>
    `;
  }
  return `<text class="root" x="${x}" y="${centerY}" font-size="12" font-weight="700" dominant-baseline="middle" fill="#000000">Standard</text>`;
}

export function buildDetailExportSvg(viewModel: DetailExportViewModel) {
  const rowHeights = viewModel.rows.length > 0 ? viewModel.rows.map(getRowHeight) : [ROW_HEIGHT];
  const tableBodyHeight = rowHeights.reduce((sum, value) => sum + value, 0);
  const height = TOP_BORDER + HEADER_HEIGHT + STATS_HEIGHT + TABLE_HEADER_HEIGHT + tableBodyHeight + FOOTER_HEIGHT + FOOTNOTE_HEIGHT + BOTTOM_MARGIN;
  const sheetWidth = WIDTH - SIDE_PADDING * 2;
  const logoDataUri = resolveLogoDataUri();
  const tableStartY = TOP_BORDER + HEADER_HEIGHT + STATS_HEIGHT;
  const bodyStartY = tableStartY + TABLE_HEADER_HEIGHT;
  const footerY = bodyStartY + tableBodyHeight;
  const footnoteY = footerY + FOOTER_HEIGHT;

  let nextRowTop = bodyStartY;
  const rows = viewModel.rows.map((row, index) => {
    const rowTop = nextRowTop;
    const rowHeight = rowHeights[index] ?? ROW_HEIGHT;
    const rowBottom = rowTop + rowHeight;
    const centerY = rowTop + rowHeight / 2;
    nextRowTop = rowBottom;
    return `
      <line x1="${SIDE_PADDING}" y1="${rowBottom}" x2="${WIDTH - SIDE_PADDING}" y2="${rowBottom}" stroke="${COLORS.row}" stroke-width="1" />
      <text class="root" x="${TABLE_COLUMNS.index}" y="${centerY}" font-size="11" dominant-baseline="middle" fill="${COLORS.blue}">${row.index}</text>
      <text class="root" x="${TABLE_COLUMNS.mark}" y="${centerY}" font-size="15" font-weight="700" dominant-baseline="middle" fill="#000000">${escapeXml(row.mark)}</text>
      ${buildWrappedOrderText(row, centerY)}
      ${buildTypeBadge(row.type, TABLE_COLUMNS.type, centerY)}
      <text class="root" x="${TABLE_COLUMNS.amount}" y="${centerY}" font-size="15" font-weight="700" dominant-baseline="middle" text-anchor="end" fill="#000000">$${escapeXml(formatAmount(row.amount))}</text>
    `;
  }).join('');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">
      <style>
        .root { font-family: Arial, Helvetica, sans-serif; }
      </style>
      <rect width="${WIDTH}" height="${height}" fill="#ffffff" />
      <rect x="${SIDE_PADDING}" y="0" width="${sheetWidth}" height="${TOP_BORDER}" fill="${COLORS.blue}" />
      <rect x="${SIDE_PADDING}" y="${TOP_BORDER}" width="${sheetWidth}" height="${height - TOP_BORDER}" fill="#ffffff" stroke="${COLORS.border}" stroke-width="1" />

      <line x1="${SIDE_PADDING}" y1="${TOP_BORDER + HEADER_HEIGHT}" x2="${WIDTH - SIDE_PADDING}" y2="${TOP_BORDER + HEADER_HEIGHT}" stroke="${COLORS.border}" stroke-width="1" />
      <image href="${logoDataUri}" x="${SIDE_PADDING + 10}" y="${TOP_BORDER + 26}" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" preserveAspectRatio="xMinYMid meet" />
      <text class="root" x="${WIDTH - SIDE_PADDING - 10}" y="${TOP_BORDER + 46}" font-size="12" text-anchor="end" fill="${COLORS.blue}">${escapeXml(viewModel.dateLabel)}</text>

      <line x1="${SIDE_PADDING + sheetWidth / 2}" y1="${TOP_BORDER + HEADER_HEIGHT}" x2="${SIDE_PADDING + sheetWidth / 2}" y2="${TOP_BORDER + HEADER_HEIGHT + STATS_HEIGHT}" stroke="${COLORS.border}" stroke-width="1" />
      <line x1="${SIDE_PADDING}" y1="${TOP_BORDER + HEADER_HEIGHT + STATS_HEIGHT}" x2="${WIDTH - SIDE_PADDING}" y2="${TOP_BORDER + HEADER_HEIGHT + STATS_HEIGHT}" stroke="${COLORS.border}" stroke-width="1" />
      <text class="root" x="${SIDE_PADDING + 10}" y="${TOP_BORDER + HEADER_HEIGHT + 21}" font-size="11" font-weight="700" fill="#000000" letter-spacing="1.1">TOTAL</text>
      <text class="root" x="${SIDE_PADDING + 10}" y="${TOP_BORDER + HEADER_HEIGHT + 51}" font-size="24" font-weight="700" fill="${COLORS.blue}">$${escapeXml(formatAmount(viewModel.totalAmount))}</text>
      <text class="root" x="${SIDE_PADDING + sheetWidth / 2 + 10}" y="${TOP_BORDER + HEADER_HEIGHT + 21}" font-size="11" font-weight="700" fill="#000000" letter-spacing="1.1">TRANSACTIONS</text>
      <text class="root" x="${SIDE_PADDING + sheetWidth / 2 + 10}" y="${TOP_BORDER + HEADER_HEIGHT + 51}" font-size="24" font-weight="700" fill="${COLORS.blue}">${viewModel.transactionCount}</text>

      <rect x="${SIDE_PADDING}" y="${tableStartY}" width="${sheetWidth}" height="${TABLE_HEADER_HEIGHT}" fill="${COLORS.blue}" />
      <text class="root" x="${TABLE_COLUMNS.index}" y="${tableStartY + 28}" font-size="16" font-weight="700" fill="#ffffff" letter-spacing="0.8">#</text>
      <text class="root" x="${TABLE_COLUMNS.mark}" y="${tableStartY + 28}" font-size="16" font-weight="700" fill="#ffffff" letter-spacing="0.8">MARK</text>
      <text class="root" x="${TABLE_COLUMNS.orderNo}" y="${tableStartY + 28}" font-size="16" font-weight="700" fill="#ffffff" letter-spacing="0.8">ORDER NO</text>
      <text class="root" x="${TABLE_COLUMNS.type}" y="${tableStartY + 28}" font-size="16" font-weight="700" fill="#ffffff" letter-spacing="0.8">TYPE</text>
      <text class="root" x="${TABLE_COLUMNS.amount}" y="${tableStartY + 28}" font-size="16" font-weight="700" text-anchor="end" fill="#ffffff" letter-spacing="0.8">AMOUNT</text>
      <line x1="${SIDE_PADDING}" y1="${bodyStartY}" x2="${WIDTH - SIDE_PADDING}" y2="${bodyStartY}" stroke="${COLORS.border}" stroke-width="1" />
      ${rows}

      <rect x="${SIDE_PADDING}" y="${footerY}" width="${sheetWidth}" height="${FOOTER_HEIGHT}" fill="${COLORS.blue}" />
      <text class="root" x="${SIDE_PADDING + 10}" y="${footerY + 34}" font-size="22" font-weight="700" fill="#ffffff" letter-spacing="0.6">TOTAL TRANSFERRED</text>
      <text class="root" x="${WIDTH - SIDE_PADDING - 10}" y="${footerY + 34}" font-size="22" font-weight="700" text-anchor="end" fill="#ffffff">$${escapeXml(formatAmount(viewModel.totalAmount))}</text>

      <text class="root" x="${SIDE_PADDING + 10}" y="${footnoteY + 22}" font-size="15" fill="${COLORS.blue}">${escapeXml(`${viewModel.footerAgentLabel} · Disbursement`)}</text>
      <text class="root" x="${WIDTH - SIDE_PADDING - 10}" y="${footnoteY + 22}" font-size="15" text-anchor="end" fill="${COLORS.blue}">${escapeXml(`${viewModel.transactionCount} records`)}</text>
    </svg>
  `;
}

export async function renderDetailExportJpeg(viewModel: DetailExportViewModel) {
  const svg = buildDetailExportSvg(viewModel);
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: 'width',
      value: WIDTH,
    },
    font: {
      loadSystemFonts: true,
      fontFiles: getDetailExportFontPaths(),
      defaultFontFamily: 'Arial',
    },
  });
  const pngBuffer = resvg.render().asPng();
  return sharp(pngBuffer)
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer();
}
