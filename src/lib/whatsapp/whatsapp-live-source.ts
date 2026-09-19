import type { DbTransactionClient } from '@/lib/transaction';
import type { EmailNotification } from '@prisma/client';
import { formatCustomerPayerLabel } from '@/lib/customer-display';
import { SYSTEM_POOL_INVOICE_NOS } from '@/lib/payment-type-classifier';
import { computeReceiptBalanceAfter } from './whatsapp-buffer';

const customerSelect = { id: true, name: true, companyName: true, mark: true, phone: true, notificationLanguage: true } as const;
const split = (value: string | null) => [...new Set((value || '').split('/').map(s => s.trim()).filter(Boolean))];

export async function resolveWhatsAppSource(tx: DbTransactionClient, source: EmailNotification) {
  if (source.receiptId) {
    const receipt = await tx.receipt.findUnique({ where: { id: source.receiptId }, include: {
      customer: { select: customerSelect },
      generatedByBalanceTransfer: { select: { id: true } },
      detailItems: { select: { detailId: true } },
      order: { include: { receipts: { select: { id: true, createdAt: true, usd: true, status: true, detailItems: { select: { detailId: true } } } }, invoice: true } },
    } });
    if (!receipt?.customer || receipt.status === 'SIGNING_PENDING' || receipt.generatedByBalanceTransfer || receipt.receiptNo?.startsWith('TRANSFER-')) return null;
    // Later messages depend on earlier payments too; hold them rather than send
    // a balance including a receipt whose deletion is awaiting approval.
    const dependencies = (receipt.order?.receipts || [receipt]).filter(row => row.createdAt < receipt.createdAt
      || (row.createdAt.getTime() === receipt.createdAt.getTime() && row.id <= receipt.id));
    const paused = Boolean(await tx.deletionRequest.findFirst({ where: { status: 'PENDING', OR: [
      { targetType: 'RECEIPT', targetId: { in: [...new Set([receipt.id, ...dependencies.map(row => row.id)])] } },
      { targetType: 'DETAIL', targetId: { in: [...new Set([...receipt.detailItems, ...dependencies.flatMap(row => row.detailItems)].map(item => item.detailId))] } },
    ] }, select: { id: true } }));
    const customer = receipt.customer;
    const order = receipt.order?.customerId === customer.id ? receipt.order : null;
    const invoice = order?.invoice && !SYSTEM_POOL_INVOICE_NOS.has(order.invoice.invNo) ? order.invoice : null;
    return { customer, paused, snapshot: {
      customerId: customer.id, customerName: formatCustomerPayerLabel(customer), mark: customer.mark,
      language: customer.notificationLanguage, orderId: order?.id || null,
      orderNos: split(receipt.orderNo), invoiceNo: invoice?.invNo || null,
      receiptNo: receipt.receiptNo || receipt.id, amount: Number(receipt.usd),
      orderBalance: order ? computeReceiptBalanceAfter(order, receipt) : null,
      paymentDate: (receipt.date || receipt.createdAt).toISOString(),
      ...(invoice?.shipDate ? { shipmentDate: invoice.shipDate.toISOString() } : {}),
      ...(invoice?.releaseDate ? { releaseDate: invoice.releaseDate.toISOString() } : {}),
    } };
  }
  if (!source.invoiceId || !source.customerId) return null;
  const invoice = await tx.invoice.findUnique({ where: { id: source.invoiceId }, include: {
    orders: { where: { customerId: source.customerId }, include: { customer: { select: customerSelect } } },
  } });
  const customer = invoice?.orders[0]?.customer;
  const date = source.type === 'SHIPMENT' ? invoice?.shipDate : invoice?.releaseDate;
  if (!invoice || !customer || !date) return null;
  return { customer, paused: false, snapshot: {
    customerId: customer.id, customerName: formatCustomerPayerLabel(customer), mark: customer.mark,
    language: customer.notificationLanguage, invoiceNo: invoice.invNo,
    orderNos: [...new Set(invoice.orders.flatMap(order => split(order.orderNo)))].sort(),
    ...(source.type === 'SHIPMENT' ? { shipmentDate: date.toISOString() } : { releaseDate: date.toISOString() }),
  } };
}
