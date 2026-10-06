import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { renderCustomerOutstandingStatementSvg } from './customer-outstanding-export-image';
import { customerOutstandingStatementLabels } from './customer-outstanding-statement-labels';
import type { DashboardCustomerOutstanding } from './dashboard-customer-outstanding';
import { formatAppDate } from './app-time';

export async function renderOutstandingStatementPng(outstanding: DashboardCustomerOutstanding, date: Date) {
  const assetDir = path.join(process.cwd(), 'public/detail-export');
  const logo = await readFile(path.join(assetDir, 'payment-detail-logo.png'));
  const svg = renderCustomerOutstandingStatementSvg({
    customerMark: outstanding.customerMark, outstanding,
    statementDate: formatAppDate(date), labels: customerOutstandingStatementLabels('fr'),
  }, `data:image/png;base64,${logo.toString('base64')}`);
  const image = new Resvg(svg, { fitTo: { mode: 'width', value: 1440 },
    font: { loadSystemFonts: false, fontFiles: [path.join(assetDir, 'arial.ttf'), path.join(assetDir, 'arial-bold.ttf')], defaultFontFamily: 'Arial' } });
  const png = image.render().asPng();
  if (png.length > 5 * 1024 * 1024) throw new Error('Statement exceeds WhatsApp image size limit.');
  return png;
}
