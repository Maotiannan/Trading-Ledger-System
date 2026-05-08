import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { formatOrderNameDisplay, formatUsdAmount } from '@/lib/display-format';
import type { CurrentUser } from '@/lib/request-auth';
import {
  buildDetailVisibilityWhere,
  buildInvoiceVisibilityWhere,
  buildOrderVisibilityWhere,
  buildReceiptVisibilityWhere,
  buildSwiftVisibilityWhere,
  getOwnerVisibleIds,
} from '@/lib/resource-visibility';

export type ReportExportFormat = 'excel' | 'pdf';

export function buildReportFileName(ext: 'xlsx' | 'pdf'): string {
  const date = new Date().toISOString().slice(0, 10);
  return `trading-ledger-report-${date}.${ext}`;
}

async function exportExcel(currentUser: CurrentUser) {
  const ownerIds = await getOwnerVisibleIds(currentUser);
  const invoiceWhere = buildInvoiceVisibilityWhere(ownerIds);
  const orderWhere = buildOrderVisibilityWhere(ownerIds);
  const receiptWhere = buildReceiptVisibilityWhere(ownerIds);
  const detailWhere = buildDetailVisibilityWhere(ownerIds);
  const swiftWhere = buildSwiftVisibilityWhere(ownerIds);

  const [invoices, receipts, details, swifts] = await Promise.all([
    db.invoice.findMany({
      where: invoiceWhere,
      include: {
        orders: {
          where: orderWhere,
          include: {
            receipts: {
              where: receiptWhere,
              select: { usd: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    db.receipt.findMany({ where: receiptWhere, orderBy: { createdAt: 'desc' } }),
    db.detail.findMany({ where: detailWhere, orderBy: { createdAt: 'desc' } }),
    db.swift.findMany({ where: swiftWhere, orderBy: { createdAt: 'desc' } }),
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Trading-Ledger-System';
  workbook.created = new Date();

  const summary = workbook.addWorksheet('Summary');
  summary.addRow(['Metric', 'Value']);
  summary.addRow(['Invoices', invoices.length]);
  summary.addRow(['Receipts', receipts.length]);
  summary.addRow(['Details', details.length]);
  summary.addRow(['Swifts', swifts.length]);
  summary.getRow(1).font = { bold: true };

  const invoiceSheet = workbook.addWorksheet('Invoices');
  invoiceSheet.addRow(['Invoice No', 'Order Count', 'Amount', 'Received', 'Balance']);
  invoiceSheet.getRow(1).font = { bold: true };
  for (const invoice of invoices) {
    const amount = invoice.orders.reduce((sum, order) => sum + Number(order.amount), 0);
    const received = invoice.orders.reduce((sum, order) => sum + order.receipts.reduce((innerSum, receipt) => innerSum + Number(receipt.usd), 0), 0);
    invoiceSheet.addRow([invoice.invNo, invoice.orders.length, amount, received, amount - received]);
  }

  const receiptSheet = workbook.addWorksheet('Receipts');
  receiptSheet.addRow(['Receipt No', 'Order No', 'Amount', 'Status', 'Date']);
  receiptSheet.getRow(1).font = { bold: true };
  for (const receipt of receipts) {
    receiptSheet.addRow([
      receipt.receiptNo || '',
      formatOrderNameDisplay(receipt.orderNo, ''),
      receipt.usd,
      receipt.status,
      receipt.date ? receipt.date.toISOString().slice(0, 10) : '',
    ]);
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return {
    fileBuffer: buffer,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    counts: {
      invoiceCount: invoices.length,
      receiptCount: receipts.length,
      detailCount: details.length,
      swiftCount: swifts.length,
    },
  };
}

async function exportPdf(currentUser: CurrentUser) {
  const ownerIds = await getOwnerVisibleIds(currentUser);
  const invoiceWhere = buildInvoiceVisibilityWhere(ownerIds);
  const receiptWhere = buildReceiptVisibilityWhere(ownerIds);
  const detailWhere = buildDetailVisibilityWhere(ownerIds);
  const swiftWhere = buildSwiftVisibilityWhere(ownerIds);
  const [invoiceCount, receiptCount, detailCount, swiftCount] = await Promise.all([
    db.invoice.count({ where: invoiceWhere }),
    db.receipt.count({ where: receiptWhere }),
    db.detail.count({ where: detailWhere }),
    db.swift.count({ where: swiftWhere }),
  ]);

  const recentReceipts = await db.receipt.findMany({
    where: receiptWhere,
    take: 10,
    orderBy: { createdAt: 'desc' },
    select: { orderNo: true, usd: true, status: true, createdAt: true },
  });

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([842, 595]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = 560;
  page.drawText('Trading Ledger Report', { x: 40, y, size: 22, font: bold, color: rgb(0.1, 0.1, 0.1) });
  y -= 32;
  page.drawText(`Generated: ${new Date().toISOString()}`, { x: 40, y, size: 10, font, color: rgb(0.35, 0.35, 0.35) });
  y -= 28;

  const summaryRows = [
    ['Invoices', invoiceCount],
    ['Receipts', receiptCount],
    ['Details', detailCount],
    ['Swifts', swiftCount],
  ] as const;

  page.drawText('Summary', { x: 40, y, size: 14, font: bold });
  y -= 20;
  for (const [label, value] of summaryRows) {
    page.drawText(`${label}: ${value}`, { x: 52, y, size: 12, font });
    y -= 16;
  }

  y -= 10;
  page.drawText('Recent Receipts (Top 10)', { x: 40, y, size: 14, font: bold });
  y -= 20;

  for (const receipt of recentReceipts) {
    if (y < 40) break;
    const date = receipt.createdAt.toISOString().slice(0, 10);
    page.drawText(
      `${date} | ${formatOrderNameDisplay(receipt.orderNo)} | ${receipt.status} | USD ${formatUsdAmount(receipt.usd)}`,
      { x: 52, y, size: 10.5, font },
    );
    y -= 14;
  }

  return {
    fileBuffer: Buffer.from(await pdfDoc.save()),
    contentType: 'application/pdf',
    counts: { invoiceCount, receiptCount, detailCount, swiftCount },
  };
}

export async function exportReport(currentUser: CurrentUser, format: ReportExportFormat) {
  const result = format === 'excel' ? await exportExcel(currentUser) : await exportPdf(currentUser);
  const summaryMessage = `报表导出已生成：当前可见范围内账单 ${result.counts.invoiceCount}，收据 ${result.counts.receiptCount}，明细 ${result.counts.detailCount}，SWIFT ${result.counts.swiftCount}`;

  await recordAuditEvent({
    action: auditActions.REPORT_EXPORT,
    actorId: currentUser.id,
    targetType: auditTargetTypes.REPORT,
    metadata: {
      format,
      ...result.counts,
    },
  });

  return {
    ...result,
    fileName: buildReportFileName(format === 'excel' ? 'xlsx' : 'pdf'),
    message: summaryMessage,
  };
}
