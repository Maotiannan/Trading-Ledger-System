import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { db } from '@/lib/db';
import { findOrderIdByNoOrAlias } from '@/lib/order-alias-db';

type DetailExportSourceItem = {
  mark: string | null;
  orderNo: string | null;
  amount: number | { toString(): string };
  receipt?: {
    orderNo?: string | null;
    orderId?: string | null;
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
  type: 'Initial' | 'Final' | 'Std';
  amount: number;
};

export type DetailExportViewModel = {
  dateLabel: string;
  totalAmount: number;
  transactionCount: number;
  footerAgentLabel: string;
  rows: DetailExportRow[];
};

const WIDTH = 1560;
const SIDE_PADDING = 56;
const TOP_BORDER = 16;
const HEADER_HEIGHT = 128;
const STATS_HEIGHT = 110;
const TABLE_HEADER_HEIGHT = 48;
const ROW_HEIGHT = 54;
const FOOTER_HEIGHT = 66;
const FOOTNOTE_HEIGHT = 36;
const BOTTOM_MARGIN = 16;
const LOGO_WIDTH = 390;
const LOGO_HEIGHT = 72;
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
} as const;

const TABLE_COLUMNS = {
  index: SIDE_PADDING + 24,
  mark: SIDE_PADDING + 110,
  orderNo: SIDE_PADDING + 410,
  type: SIDE_PADDING + 730,
  amount: WIDTH - SIDE_PADDING - 14,
} as const;

let cachedLogoDataUri: string | null = null;
let cachedFontPaths: string[] | null = null;
type ResvgConstructor = new (
  svg: string,
  options?: {
    fitTo?: {
      mode: 'width';
      value: number;
    };
    font?: {
      loadSystemFonts?: boolean;
      fontFiles?: string[];
      defaultFontFamily?: string;
    };
  },
) => {
  render(): {
    asPng(): Uint8Array;
  };
};

let cachedResvgConstructor: ResvgConstructor | null = null;

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
  return value.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  });
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

function resolveResvgConstructor() {
  if (cachedResvgConstructor) {
    return cachedResvgConstructor;
  }

  const runtimeRequire = eval('require') as NodeRequire;
  const resvgModule = runtimeRequire('@resvg/resvg-js') as {
    Resvg: ResvgConstructor;
  };
  cachedResvgConstructor = resvgModule.Resvg;
  return cachedResvgConstructor;
}

type ResolvedItemAnalysis = {
  orderId: string | null;
  orderBalance: number | null;
  hasPreviousPayments: boolean;
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
  const previousPaymentMap = new Map<string, number>();

  if (uniqueOrderIds.length > 0) {
    const orderRows = await db.order.findMany({
      where: { id: { in: uniqueOrderIds } },
      select: { id: true, orderBalance: true },
    });
    for (const row of orderRows) {
      orderBalanceMap.set(row.id, Number(row.orderBalance));
    }

    const createdAtCutoff = detail.createdAt ? new Date(detail.createdAt) : null;
    if (createdAtCutoff && !Number.isNaN(createdAtCutoff.getTime())) {
      const previousRows = await db.detailItem.findMany({
        where: {
          receipt: { orderId: { in: uniqueOrderIds } },
          detail: {
            id: { not: detail.id },
            createdAt: { lt: createdAtCutoff },
          },
        },
        select: {
          receipt: {
            select: { orderId: true },
          },
        },
      });

      for (const row of previousRows) {
        const orderId = row.receipt?.orderId;
        if (!orderId) continue;
        previousPaymentMap.set(orderId, (previousPaymentMap.get(orderId) ?? 0) + 1);
      }
    }
  }

  return resolvedOrderIds.map((orderId) => ({
    orderId,
    orderBalance: orderId ? (orderBalanceMap.get(orderId) ?? null) : null,
    hasPreviousPayments: orderId ? (previousPaymentMap.get(orderId) ?? 0) > 0 : false,
  }));
}

function determineType(detail: DetailExportSource, analysis: ResolvedItemAnalysis): DetailExportRow['type'] {
  const swiftReceived = detail.swift?.status === 'RECEIVED';
  if (swiftReceived && typeof analysis.orderBalance === 'number' && analysis.orderBalance <= 5) {
    return 'Final';
  }
  if (analysis.orderId && !analysis.hasPreviousPayments) {
    return 'Initial';
  }
  return 'Std';
}

export async function buildDetailExportViewModel(detail: DetailExportSource): Promise<DetailExportViewModel> {
  const rowsAnalysis = await analyzeDetailItems(detail);
  const rows = detail.items.map((item, index) => {
    const amount = toNumber(item.amount);
    const analysis = rowsAnalysis[index] ?? { orderId: null, orderBalance: null, hasPreviousPayments: false };
    return {
      index: index + 1,
      mark: normalizeText(item.mark),
      orderNo: normalizeText(item.orderNo || item.receipt?.orderNo),
      type: determineType(detail, analysis),
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

function buildTypeBadge(type: DetailExportRow['type'], x: number, baseline: number) {
  if (type === 'Final') {
    return `
      <rect x="${x}" y="${baseline - 18}" width="58" height="24" rx="4" fill="${COLORS.pinkBg}" />
      <text class="root" x="${x + 29}" y="${baseline}" font-size="12" font-weight="700" text-anchor="middle" fill="${COLORS.pink}">Final</text>
    `;
  }
  if (type === 'Initial') {
    return `
      <rect x="${x}" y="${baseline - 18}" width="64" height="24" rx="4" fill="${COLORS.indigoBg}" />
      <text class="root" x="${x + 32}" y="${baseline}" font-size="12" font-weight="700" text-anchor="middle" fill="${COLORS.indigo}">Initial</text>
    `;
  }
  return `<text class="root" x="${x}" y="${baseline}" font-size="12" fill="${COLORS.muted}">Std</text>`;
}

export function buildDetailExportSvg(viewModel: DetailExportViewModel) {
  const rowCount = Math.max(viewModel.rows.length, 1);
  const tableBodyHeight = rowCount * ROW_HEIGHT;
  const height = TOP_BORDER + HEADER_HEIGHT + STATS_HEIGHT + TABLE_HEADER_HEIGHT + tableBodyHeight + FOOTER_HEIGHT + FOOTNOTE_HEIGHT + BOTTOM_MARGIN;
  const sheetWidth = WIDTH - SIDE_PADDING * 2;
  const logoDataUri = resolveLogoDataUri();
  const tableStartY = TOP_BORDER + HEADER_HEIGHT + STATS_HEIGHT;
  const bodyStartY = tableStartY + TABLE_HEADER_HEIGHT;
  const footerY = bodyStartY + tableBodyHeight;
  const footnoteY = footerY + FOOTER_HEIGHT;

  const rows = viewModel.rows.map((row, index) => {
    const rowTop = bodyStartY + index * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT;
    const baseline = rowTop + 33;
    return `
      <line x1="${SIDE_PADDING}" y1="${rowBottom}" x2="${WIDTH - SIDE_PADDING}" y2="${rowBottom}" stroke="${COLORS.row}" stroke-width="1" />
      <text class="root" x="${TABLE_COLUMNS.index}" y="${baseline}" font-size="12" fill="#cccccc">${row.index}</text>
      <text class="root" x="${TABLE_COLUMNS.mark}" y="${baseline}" font-size="17" font-weight="700" fill="#000000">${escapeXml(row.mark)}</text>
      <text class="root" x="${TABLE_COLUMNS.orderNo}" y="${baseline}" font-size="14" fill="${COLORS.muted}">${escapeXml(row.orderNo)}</text>
      ${buildTypeBadge(row.type, TABLE_COLUMNS.type, baseline)}
      <text class="root" x="${TABLE_COLUMNS.amount}" y="${baseline}" font-size="17" font-weight="700" text-anchor="end" fill="#000000">$${escapeXml(formatAmount(row.amount))}</text>
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
      <image href="${logoDataUri}" x="${SIDE_PADDING + 14}" y="${TOP_BORDER + 38}" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" preserveAspectRatio="xMinYMid meet" />
      <text class="root" x="${WIDTH - SIDE_PADDING - 14}" y="${TOP_BORDER + 58}" font-size="16" text-anchor="end" fill="${COLORS.muted}">${escapeXml(viewModel.dateLabel)}</text>

      <line x1="${SIDE_PADDING + sheetWidth / 2}" y1="${TOP_BORDER + HEADER_HEIGHT}" x2="${SIDE_PADDING + sheetWidth / 2}" y2="${TOP_BORDER + HEADER_HEIGHT + STATS_HEIGHT}" stroke="${COLORS.border}" stroke-width="1" />
      <line x1="${SIDE_PADDING}" y1="${TOP_BORDER + HEADER_HEIGHT + STATS_HEIGHT}" x2="${WIDTH - SIDE_PADDING}" y2="${TOP_BORDER + HEADER_HEIGHT + STATS_HEIGHT}" stroke="${COLORS.border}" stroke-width="1" />
      <text class="root" x="${SIDE_PADDING + 14}" y="${TOP_BORDER + HEADER_HEIGHT + 26}" font-size="14" fill="#aaaaaa" letter-spacing="1.4">TOTAL</text>
      <text class="root" x="${SIDE_PADDING + 14}" y="${TOP_BORDER + HEADER_HEIGHT + 72}" font-size="38" font-weight="700" fill="${COLORS.blue}">$${escapeXml(formatAmount(viewModel.totalAmount))}</text>
      <text class="root" x="${SIDE_PADDING + sheetWidth / 2 + 14}" y="${TOP_BORDER + HEADER_HEIGHT + 26}" font-size="14" fill="#aaaaaa" letter-spacing="1.4">TRANSACTIONS</text>
      <text class="root" x="${SIDE_PADDING + sheetWidth / 2 + 14}" y="${TOP_BORDER + HEADER_HEIGHT + 72}" font-size="38" font-weight="700" fill="${COLORS.blue}">${viewModel.transactionCount}</text>

      <text class="root" x="${TABLE_COLUMNS.index}" y="${tableStartY + 30}" font-size="13" fill="${COLORS.lightMuted}" letter-spacing="1.2">#</text>
      <text class="root" x="${TABLE_COLUMNS.mark}" y="${tableStartY + 30}" font-size="13" fill="${COLORS.lightMuted}" letter-spacing="1.2">MARK</text>
      <text class="root" x="${TABLE_COLUMNS.orderNo}" y="${tableStartY + 30}" font-size="13" fill="${COLORS.lightMuted}" letter-spacing="1.2">ORDER NO</text>
      <text class="root" x="${TABLE_COLUMNS.type}" y="${tableStartY + 30}" font-size="13" fill="${COLORS.lightMuted}" letter-spacing="1.2">TYPE</text>
      <text class="root" x="${TABLE_COLUMNS.amount}" y="${tableStartY + 30}" font-size="13" text-anchor="end" fill="${COLORS.lightMuted}" letter-spacing="1.2">AMOUNT</text>
      <line x1="${SIDE_PADDING}" y1="${bodyStartY}" x2="${WIDTH - SIDE_PADDING}" y2="${bodyStartY}" stroke="${COLORS.border}" stroke-width="1" />
      ${rows}

      <rect x="${SIDE_PADDING}" y="${footerY}" width="${sheetWidth}" height="${FOOTER_HEIGHT}" fill="${COLORS.blue}" />
      <text class="root" x="${SIDE_PADDING + 14}" y="${footerY + 26}" font-size="12" font-weight="700" fill="rgba(255,255,255,0.65)" letter-spacing="1.2">TOTAL TRANSFERRED</text>
      <text class="root" x="${WIDTH - SIDE_PADDING - 14}" y="${footerY + 41}" font-size="28" font-weight="700" text-anchor="end" fill="#ffffff">$${escapeXml(formatAmount(viewModel.totalAmount))}</text>

      <text class="root" x="${SIDE_PADDING + 14}" y="${footnoteY + 26}" font-size="12" fill="#cccccc">${escapeXml(`${viewModel.footerAgentLabel} · Disbursement`)}</text>
      <text class="root" x="${WIDTH - SIDE_PADDING - 14}" y="${footnoteY + 26}" font-size="12" text-anchor="end" fill="#cccccc">${escapeXml(`${viewModel.transactionCount} records`)}</text>
    </svg>
  `;
}

export async function renderDetailExportJpeg(viewModel: DetailExportViewModel) {
  const svg = buildDetailExportSvg(viewModel);
  const Resvg = resolveResvgConstructor();
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
