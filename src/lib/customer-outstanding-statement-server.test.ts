/** @jest-environment node */
import { renderOutstandingStatementPng } from './customer-outstanding-statement-server';
import { renderCustomerOutstandingStatementSvg } from './customer-outstanding-export-image';
import { customerOutstandingStatementLabels } from './customer-outstanding-statement-labels';
import type { DashboardCustomerOutstanding } from './dashboard-customer-outstanding';
import sharp from 'sharp';

const outstanding: DashboardCustomerOutstanding = {
  customerId: 'example', customerKey: 'example', customerLabel: 'EXAMPLE', customerMark: 'EXAMPLE', totalOutstanding: 5020,
  statusSubtotals: { released: 3020, inTransit: 2000 }, orders: [
    { orderId: '1', orderNo: 'EXAMPLE-01', invNo: 'INV-1', outstanding: 3000, statusGroup: 'RELEASED', releaseDate: '2026-08-01', daysSinceRelease: 66 },
    { orderId: '2', orderNo: 'EXAMPLE-02', invNo: 'INV-2', outstanding: 20, statusGroup: 'RELEASED', releaseDate: '2026-08-01', daysSinceRelease: 66 },
    { orderId: '3', orderNo: 'EXAMPLE-03', invNo: 'INV-3', outstanding: 2000, statusGroup: 'IN_TRANSIT', releaseDate: null, daysSinceRelease: null },
  ],
};
it('renders an actual PNG using the shared full French statement, including small balances and transit', async () => {
  const png = await renderOutstandingStatementPng(outstanding, new Date('2026-10-06T07:00:00Z'));
  expect((await sharp(png).metadata()).width).toBe(1440);
  const svg = renderCustomerOutstandingStatementSvg({ outstanding, customerMark: 'EXAMPLE', statementDate: '06/10/2026', labels: customerOutstandingStatementLabels('fr') }, 'data:image/png;base64,');
  for (const text of ['EXAMPLE-01', 'EXAMPLE-02', 'EXAMPLE-03', 'JOURS', '$5,020', 'COMMANDES EN TRANSIT']) expect(svg).toContain(text);
});
