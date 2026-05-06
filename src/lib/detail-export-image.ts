import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

type DetailExportReceipt = {
  note?: string | null;
};

type DetailExportItem = {
  mark: string | null;
  orderNo: string | null;
  amount: number | { toString(): string };
  receipt?: DetailExportReceipt | null;
};

type DetailExportRecord = {
  id: string;
  date: string | Date | null;
  items: DetailExportItem[];
};

const WIDTH = 1560;
const SIDE_PADDING = 56;
const TOP_BORDER = 16;
const HEADER_HEIGHT = 128;
const STATS_HEIGHT = 110;
const TABLE_HEADER_HEIGHT = 48;
const ROW_HEIGHT = 54;
const FOOTER_HEIGHT = 66;
const BOTTOM_MARGIN = 24;
const LOGO_WIDTH = 260;
const TABLE_COLUMNS = {
  index: 40,
  mark: 260,
  order: 340,
  type: 150,
  amount: 170,
} as const;

let cachedLogoDataUri: string | null = null;

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatAmount(value: number) {
  const normalized = Number(value) || 0;
  return normalized.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(normalized) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function formatSheetDate(date: string | Date | null) {
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
  const logoPath = path.join(process.cwd(), 'public', 'logo.svg');
  try {
    const svg = fs.readFileSync(logoPath, 'utf8');
    cachedLogoDataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  } catch {
    cachedLogoDataUri = '';
  }
  return cachedLogoDataUri;
}

function classifyTransferType(item: DetailExportItem) {
  const note = item.receipt?.note?.trim().toLowerCase() ?? '';
  if (note.includes('final')) return 'Final';
  if (note.includes('initial')) return 'Initial';
  return 'Std';
}

function buildTypeBadge(type: string, x: number, y: number) {
  if (type === 'Final') {
    return `
      <rect x="${x}" y="${y - 18}" width="58" height="24" rx="4" fill="#fde8f2" />
      <text x="${x + 29}" y="${y}" font-size="12" font-weight="700" text-anchor="middle" fill="#e84789">Final</text>
    `;
  }
  if (type === 'Initial') {
    return `
      <rect x="${x}" y="${y - 18}" width="64" height="24" rx="4" fill="#eaedfa" />
      <text x="${x + 32}" y="${y}" font-size="12" font-weight="700" text-anchor="middle" fill="#415cc3">Initial</text>
    `;
  }
  return `<text x="${x}" y="${y}" font-size="12" fill="#999999">Std</text>`;
}

export function buildDetailExportSvg(detail: DetailExportRecord) {
  const items = detail.items || [];
  const totalAmount = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const rowCount = Math.max(items.length, 1);
  const tableBodyHeight = rowCount * ROW_HEIGHT;
  const height = TOP_BORDER + HEADER_HEIGHT + STATS_HEIGHT + TABLE_HEADER_HEIGHT + tableBodyHeight + FOOTER_HEIGHT + BOTTOM_MARGIN;
  const sheetWidth = WIDTH - SIDE_PADDING * 2;
  const dateText = formatSheetDate(detail.date);
  const logoDataUri = resolveLogoDataUri();
  const titleDate = detail.date ? new Date(detail.date) : null;
  const footerDate = titleDate && !Number.isNaN(titleDate.getTime())
    ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', day: '2-digit', month: '2-digit', year: '2-digit' }).format(titleDate)
    : '';

  const tableStartY = TOP_BORDER + HEADER_HEIGHT + STATS_HEIGHT;
  const bodyStartY = tableStartY + TABLE_HEADER_HEIGHT;
  const footerY = bodyStartY + tableBodyHeight;
  const totalLabel = `Total transferred`;
  const totalValue = `$${formatAmount(totalAmount)}`;
  const colX = {
    index: SIDE_PADDING + 14,
    mark: SIDE_PADDING + 70,
    order: SIDE_PADDING + 340,
    type: SIDE_PADDING + 710,
    amount: WIDTH - SIDE_PADDING - 14,
  };

  const rows = items.map((item, index) => {
    const rowTop = bodyStartY + index * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT;
    const baseline = rowTop + 33;
    const amount = Number(item.amount || 0);
    const transferType = classifyTransferType(item);
    return `
      <line x1="${SIDE_PADDING}" y1="${rowBottom}" x2="${WIDTH - SIDE_PADDING}" y2="${rowBottom}" stroke="#f2f2f2" stroke-width="1" />
      <text x="${colX.index}" y="${baseline}" font-size="12" fill="#cccccc">${index + 1}</text>
      <text x="${colX.mark}" y="${baseline}" font-size="17" font-weight="700" fill="#000000">${escapeXml((item.mark || '-').trim() || '-')}</text>
      <text x="${colX.order}" y="${baseline}" font-size="14" fill="#999999">${escapeXml((item.orderNo || '-').trim() || '-')}</text>
      ${buildTypeBadge(transferType, colX.type, baseline)}
      <text x="${colX.amount}" y="${baseline}" font-size="17" font-weight="700" text-anchor="end" fill="#000000">$${escapeXml(formatAmount(amount))}</text>
    `;
  }).join('');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">
      <rect width="${WIDTH}" height="${height}" fill="#ffffff" />
      <rect x="${SIDE_PADDING}" y="0" width="${sheetWidth}" height="${TOP_BORDER}" fill="#415cc3" />
      <rect x="${SIDE_PADDING}" y="${TOP_BORDER}" width="${sheetWidth}" height="${height - TOP_BORDER}" fill="#ffffff" stroke="#eeeeee" stroke-width="1" />
      <line x1="${SIDE_PADDING}" y1="${TOP_BORDER + HEADER_HEIGHT}" x2="${WIDTH - SIDE_PADDING}" y2="${TOP_BORDER + HEADER_HEIGHT}" stroke="#eeeeee" stroke-width="1" />
      ${logoDataUri ? `<image href="${logoDataUri}" x="${SIDE_PADDING + 14}" y="${TOP_BORDER + 22}" width="${LOGO_WIDTH}" height="72" preserveAspectRatio="xMidYMid meet" />` : ''}
      <text x="${WIDTH - SIDE_PADDING - 14}" y="${TOP_BORDER + 36}" font-size="16" text-anchor="end" fill="#999999">Date</text>
      <text x="${WIDTH - SIDE_PADDING - 14}" y="${TOP_BORDER + 60}" font-size="28" font-weight="700" text-anchor="end" fill="#415cc3">${escapeXml(dateText)}</text>

      <line x1="${SIDE_PADDING + sheetWidth / 2}" y1="${TOP_BORDER + HEADER_HEIGHT}" x2="${SIDE_PADDING + sheetWidth / 2}" y2="${TOP_BORDER + HEADER_HEIGHT + STATS_HEIGHT}" stroke="#eeeeee" stroke-width="1" />
      <line x1="${SIDE_PADDING}" y1="${TOP_BORDER + HEADER_HEIGHT + STATS_HEIGHT}" x2="${WIDTH - SIDE_PADDING}" y2="${TOP_BORDER + HEADER_HEIGHT + STATS_HEIGHT}" stroke="#eeeeee" stroke-width="1" />
      <text x="${SIDE_PADDING + 14}" y="${TOP_BORDER + HEADER_HEIGHT + 26}" font-size="14" fill="#aaaaaa" letter-spacing="1.4">TOTAL</text>
      <text x="${SIDE_PADDING + 14}" y="${TOP_BORDER + HEADER_HEIGHT + 72}" font-size="38" font-weight="700" fill="#415cc3">$${escapeXml(formatAmount(totalAmount))}</text>
      <text x="${SIDE_PADDING + sheetWidth / 2 + 14}" y="${TOP_BORDER + HEADER_HEIGHT + 26}" font-size="14" fill="#aaaaaa" letter-spacing="1.4">TRANSACTIONS</text>
      <text x="${SIDE_PADDING + sheetWidth / 2 + 14}" y="${TOP_BORDER + HEADER_HEIGHT + 72}" font-size="38" font-weight="700" fill="#415cc3">${items.length}</text>

      <text x="${colX.index}" y="${tableStartY + 30}" font-size="13" fill="#bbbbbb" letter-spacing="1.2">#</text>
      <text x="${colX.mark}" y="${tableStartY + 30}" font-size="13" fill="#bbbbbb" letter-spacing="1.2">MARK</text>
      <text x="${colX.order}" y="${tableStartY + 30}" font-size="13" fill="#bbbbbb" letter-spacing="1.2">ORDER</text>
      <text x="${colX.type}" y="${tableStartY + 30}" font-size="13" fill="#bbbbbb" letter-spacing="1.2">TYPE</text>
      <text x="${colX.amount}" y="${tableStartY + 30}" font-size="13" text-anchor="end" fill="#bbbbbb" letter-spacing="1.2">AMOUNT</text>
      <line x1="${SIDE_PADDING}" y1="${bodyStartY}" x2="${WIDTH - SIDE_PADDING}" y2="${bodyStartY}" stroke="#eeeeee" stroke-width="1" />
      ${rows}

      <rect x="${SIDE_PADDING}" y="${footerY}" width="${sheetWidth}" height="${FOOTER_HEIGHT}" fill="#415cc3" />
      <text x="${SIDE_PADDING + 14}" y="${footerY + 26}" font-size="12" font-weight="700" fill="rgba(255,255,255,0.65)" letter-spacing="1.2" text-transform="uppercase">${totalLabel}</text>
      <text x="${WIDTH - SIDE_PADDING - 14}" y="${footerY + 41}" font-size="28" font-weight="700" text-anchor="end" fill="#ffffff">${totalValue}</text>

      <text x="${SIDE_PADDING + 14}" y="${footerY + FOOTER_HEIGHT + 26}" font-size="12" fill="#cccccc">Mitty Group · Disbursement</text>
      <text x="${WIDTH - SIDE_PADDING - 14}" y="${footerY + FOOTER_HEIGHT + 26}" font-size="12" text-anchor="end" fill="#cccccc">${escapeXml(`${items.length} records`)}${footerDate ? ` · ${escapeXml(footerDate)}` : ''}</text>
    </svg>
  `;
}

export async function renderDetailExportJpeg(detail: DetailExportRecord) {
  const svg = buildDetailExportSvg(detail);
  return sharp(Buffer.from(svg))
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer();
}
