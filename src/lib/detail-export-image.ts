import sharp from 'sharp';

type DetailExportItem = {
  mark: string | null;
  orderNo: string | null;
  amount: number | { toString(): string };
};

type DetailExportRecord = {
  id: string;
  date: string | Date | null;
  items: DetailExportItem[];
};

const WIDTH = 1280;
const HEADER_HEIGHT = 120;
const FOOTER_HEIGHT = 90;
const ROW_HEIGHT = 54;
const PADDING_X = 44;
const GRID_SIZE = 32;

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

function formatHeaderDate(date: string | Date | null) {
  if (!date) return '';
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).format(parsed);
}

function buildDescription(item: DetailExportItem) {
  return item.orderNo ? `Payment for ${item.orderNo}` : 'Payment';
}

function buildGraphPaper(height: number) {
  const lines: string[] = [];
  for (let x = 0; x <= WIDTH; x += GRID_SIZE) {
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#d7e1f4" stroke-width="1" />`);
  }
  for (let y = 0; y <= height; y += GRID_SIZE) {
    lines.push(`<line x1="0" y1="${y}" x2="${WIDTH}" y2="${y}" stroke="#d7e1f4" stroke-width="1" />`);
  }
  return lines.join('');
}

export function buildDetailExportSvg(detail: DetailExportRecord) {
  const items = detail.items || [];
  const totalAmount = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const height = HEADER_HEIGHT + FOOTER_HEIGHT + Math.max(items.length, 1) * ROW_HEIGHT + 40;
  const title = `Payment details for $${formatAmount(totalAmount)} ${formatHeaderDate(detail.date)}`.trim();
  const rows = items.map((item, index) => {
    const y = HEADER_HEIGHT + index * ROW_HEIGHT;
    return `
      <text x="${PADDING_X}" y="${y}" font-size="28" font-style="italic" fill="#202020">${index + 1}</text>
      <text x="${PADDING_X + 52}" y="${y}" font-size="30" font-family="'Times New Roman', serif" fill="#202020">${escapeXml((item.mark || '-').trim() || '-')}</text>
      <text x="${PADDING_X + 330}" y="${y}" font-size="30" font-family="'Times New Roman', serif" fill="#202020">$ ${escapeXml(formatAmount(Number(item.amount || 0)))}</text>
      <text x="${PADDING_X + 560}" y="${y}" font-size="30" font-family="'Times New Roman', serif" fill="#202020">${escapeXml(buildDescription(item))}</text>
    `;
  }).join('');

  const footerY = HEADER_HEIGHT + Math.max(items.length, 1) * ROW_HEIGHT + 20;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">
      <rect width="100%" height="100%" fill="#fbfdff" />
      ${buildGraphPaper(height)}
      <text x="${PADDING_X}" y="48" font-size="34" font-family="'Times New Roman', serif" fill="#1c1c1c">${escapeXml(title)}</text>
      ${rows}
      <text x="${PADDING_X}" y="${footerY}" font-size="34" font-family="'Times New Roman', serif" fill="#1c1c1c">${escapeXml(`Total amount transferred $${formatAmount(totalAmount)}#`)}</text>
    </svg>
  `;
}

export async function renderDetailExportPng(detail: DetailExportRecord) {
  const svg = buildDetailExportSvg(detail);
  return sharp(Buffer.from(svg)).png().toBuffer();
}
