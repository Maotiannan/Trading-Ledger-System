import type { DashboardCustomerOutstanding } from '@/lib/dashboard-customer-outstanding';

export type CustomerOutstandingStatementLabels = {
  title: string;
  customer: string;
  statementDate: string;
  totalUnpaid: string;
  released: string;
  inTransit: string;
  orderNo: string;
  balance: string;
  subtotal: string;
  contactNote: string;
};

export type CustomerOutstandingStatementInput = {
  customerMark: string;
  statementDate: string;
  outstanding: DashboardCustomerOutstanding;
  labels: CustomerOutstandingStatementLabels;
  logoUrl?: string;
};

const WIDTH = 720;
const SIDE_PADDING = 48;
const CONTENT_WIDTH = WIDTH - SIDE_PADDING * 2;
const BLUE = '#0b5cab';
const TEXT = '#172033';
const MUTED = '#65748b';
const BORDER = '#dfe6ef';
const LIGHT_BLUE = '#f5f9fe';

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function amount(value: number) {
  return `$${Math.round(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function text(value: string) {
  return escapeXml(value.trim() || '-');
}

function imageToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Unable to read logo'));
    reader.readAsDataURL(blob);
  });
}

async function loadLogoDataUrl(logoUrl: string) {
  const response = await fetch(logoUrl, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Unable to load statement logo');
  return imageToDataUrl(await response.blob());
}

function sectionMarkup(
  title: string,
  orders: DashboardCustomerOutstanding['orders'],
  subtotal: number,
  labels: CustomerOutstandingStatementLabels,
  y: number,
) {
  const sectionHeight = 45 + (orders.length + 1) * 42 + 32;
  const rows = orders.map((order, index) => {
    const rowY = y + 86 + index * 42;
    return `<line x1="${SIDE_PADDING}" y1="${rowY + 25}" x2="${WIDTH - SIDE_PADDING}" y2="${rowY + 25}" stroke="${BORDER}" />
      <text x="${SIDE_PADDING + 8}" y="${rowY}" class="body">${text(order.orderNo)}</text>
      <text x="${WIDTH - SIDE_PADDING - 8}" y="${rowY}" text-anchor="end" class="body">${amount(order.outstanding)}</text>`;
  }).join('');
  const subtotalY = y + 86 + orders.length * 42;
  return {
    height: sectionHeight,
    markup: `<text x="${SIDE_PADDING}" y="${y + 20}" class="section">${text(title).toUpperCase()}</text>
      <line x1="${SIDE_PADDING}" y1="${y + 30}" x2="${WIDTH - SIDE_PADDING}" y2="${y + 30}" stroke="#cfe0f4" stroke-width="2" />
      <text x="${SIDE_PADDING + 8}" y="${y + 65}" class="tableHead">${text(labels.orderNo)}</text>
      <text x="${WIDTH - SIDE_PADDING - 8}" y="${y + 65}" text-anchor="end" class="tableHead">${text(labels.balance)}</text>
      ${rows}
      <text x="${SIDE_PADDING + 8}" y="${subtotalY}" class="subtotal">${text(labels.subtotal)}</text>
      <text x="${WIDTH - SIDE_PADDING - 8}" y="${subtotalY}" text-anchor="end" class="subtotal">${amount(subtotal)}</text>`
  };
}

export async function buildCustomerOutstandingStatementSvg(input: CustomerOutstandingStatementInput) {
  const logoDataUrl = await loadLogoDataUrl(input.logoUrl || '/detail-export/payment-detail-logo.png');
  const released = input.outstanding.orders.filter((order) => order.statusGroup === 'RELEASED');
  const inTransit = input.outstanding.orders.filter((order) => order.statusGroup === 'IN_TRANSIT');
  const releasedSection = sectionMarkup(input.labels.released, released, input.outstanding.statusSubtotals.released, input.labels, 315);
  const inTransitSection = sectionMarkup(input.labels.inTransit, inTransit, input.outstanding.statusSubtotals.inTransit, input.labels, 315 + releasedSection.height + 18);
  const grandTotalY = 315 + releasedSection.height + 18 + inTransitSection.height + 32;
  const height = grandTotalY + 105;
  const safeMark = text(input.customerMark);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">
    <style>
      text { font-family: Arial, sans-serif; fill: ${TEXT}; }
      .title { font-size: 25px; font-weight: 700; }
      .meta { font-size: 15px; fill: ${MUTED}; }
      .metaStrong { font-size: 15px; font-weight: 700; fill: ${MUTED}; }
      .totalLabel { font-size: 16px; fill: #52627a; }
      .totalValue { font-size: 32px; font-weight: 700; fill: ${BLUE}; }
      .section { font-size: 14px; font-weight: 700; letter-spacing: 1px; fill: ${BLUE}; }
      .tableHead { font-size: 12px; font-weight: 700; letter-spacing: .6px; fill: ${MUTED}; }
      .body { font-size: 15px; }
      .subtotal { font-size: 15px; font-weight: 700; }
      .grandLabel { font-size: 17px; font-weight: 700; }
      .grandValue { font-size: 21px; font-weight: 700; fill: ${BLUE}; }
      .foot { font-size: 12px; fill: #7b8798; }
    </style>
    <rect width="100%" height="100%" fill="#ffffff" />
    <image href="${logoDataUrl}" x="${SIDE_PADDING}" y="28" width="225" height="42" preserveAspectRatio="xMinYMid meet" />
    <line x1="${SIDE_PADDING}" y1="91" x2="${WIDTH - SIDE_PADDING}" y2="91" stroke="${BLUE}" stroke-width="3" />
    <text x="${SIDE_PADDING}" y="142" class="title">${text(input.labels.title)}</text>
    <text x="${SIDE_PADDING}" y="173" class="meta">${text(input.labels.customer)}: <tspan class="metaStrong">${safeMark}</tspan></text>
    <text x="${SIDE_PADDING}" y="199" class="meta">${text(input.labels.statementDate)}: ${text(input.statementDate)}</text>
    <rect x="${SIDE_PADDING}" y="231" width="${CONTENT_WIDTH}" height="58" fill="${LIGHT_BLUE}" stroke="#d9e4f2" />
    <text x="${SIDE_PADDING + 20}" y="267" class="totalLabel">${text(input.labels.totalUnpaid)}</text>
    <text x="${WIDTH - SIDE_PADDING - 20}" y="270" text-anchor="end" class="totalValue">${amount(input.outstanding.totalOutstanding)}</text>
    ${releasedSection.markup}
    ${inTransitSection.markup}
    <line x1="${SIDE_PADDING}" y1="${grandTotalY}" x2="${WIDTH - SIDE_PADDING}" y2="${grandTotalY}" stroke="${TEXT}" stroke-width="2" />
    <text x="${SIDE_PADDING}" y="${grandTotalY + 34}" class="grandLabel">${text(input.labels.totalUnpaid).toUpperCase()}</text>
    <text x="${WIDTH - SIDE_PADDING}" y="${grandTotalY + 37}" text-anchor="end" class="grandValue">${amount(input.outstanding.totalOutstanding)}</text>
    <line x1="${SIDE_PADDING}" y1="${grandTotalY + 69}" x2="${WIDTH - SIDE_PADDING}" y2="${grandTotalY + 69}" stroke="${BORDER}" />
    <text x="${WIDTH / 2}" y="${grandTotalY + 92}" text-anchor="middle" class="foot">${text(input.labels.contactNote)}</text>
  </svg>`;
}

export async function downloadCustomerOutstandingStatement(input: CustomerOutstandingStatementInput) {
  const svg = await buildCustomerOutstandingStatementSvg(input);
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  const image = new Image();
  image.decoding = 'async';
  image.src = svgUrl;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Unable to render statement image'));
  });
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * 2;
  canvas.height = image.height * 2;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create statement canvas');
  context.scale(2, 2);
  context.drawImage(image, 0, 0);
  const pngBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Unable to encode statement image')), 'image/png');
  });
  URL.revokeObjectURL(svgUrl);
  const url = URL.createObjectURL(pngBlob);
  const anchor = document.createElement('a');
  const fileMark = input.customerMark.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'customer';
  anchor.href = url;
  anchor.download = `${fileMark}-outstanding-statement-${new Date().toISOString().slice(0, 10)}.png`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
