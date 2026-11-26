import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { previewPrepayments, reservePrepayments, releasePrepaymentPlan } from '@/lib/prepayments/service';
import { acceptPrepaymentGeneration } from '@/lib/prepayments/generation';
import { editSourceInvoiceOrder, invoiceRevision, requireWholeInvoice } from '@/lib/integrations/mucont-invoice-service';
import { listPrepaymentCredits, transferPrepayment, reversePrepaymentTransfer } from '@/lib/prepayments/transfers';
import { findOrderIdByNoOrAliasWithExecutor, mapOrderIdsByOrderNosWithExecutor } from '@/lib/order-alias-db';
import { purgeBranchBusinessData } from '@/lib/settings-write-service';
import { listInvoiceRecords } from '@/lib/invoice-read-service';
import type { CurrentUser } from '@/lib/request-auth';
import type { FinancialSnapshot, PlanResponse } from '@/lib/prepayments/contract';
import { runFinancialTransaction } from '@/lib/transaction';
import { getDashboardSummary } from '@/lib/dashboard-summary-service';
import { readCustomerHistory } from '@/lib/customer-history-service';
import { getCustomerAnalyticsDetail, normalizeAnalyticsOrders } from '@/lib/customer-analytics-service';
import { projectPaymentReceiptInTransaction } from '@/lib/email/email-notification-projector';
import { resolveWhatsAppSource } from '@/lib/whatsapp/whatsapp-live-source';
import { exportReport } from '@/lib/report-service';
import { deleteCustomerRecord } from '@/lib/customer-service';
import ExcelJS from 'exceljs';

const prefix = `prepay-it-flow-${Date.now()}`;
let sequence = 0;
const id = () => `${prefix}-${++sequence}`;
let admin: CurrentUser;
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL || '');
  if (url.hostname !== '127.0.0.1' || url.port !== '3313' || url.pathname !== '/muledger_prepayment_20261111') throw new Error('Isolated prepayment database required');
  admin = await db.user.findUniqueOrThrow({ where: { id: 'prepay-admin' } });
});
afterAll(async () => { await db.$disconnect(); });
async function client(ownerId = admin.id) {
  const label = id(); return db.customer.create({ data: { mark: label, normalizedMark: label, name: label, orderName: label,
    phone: '', city: '', ownerId, createdBy: ownerId } });
}
async function pool(customerId: string, usd = 3000) {
  const invoice = await db.invoice.upsert({ where: { invNo: 'DEPOSIT_POOL' }, create: { invNo: 'DEPOSIT_POOL', createdBy: admin.id }, update: {} });
  const order = await db.order.create({ data: { invoiceId: invoice.id, orderNo: id(), customerId, amount: 0, orderBalance: -usd, createdBy: admin.id } });
  await db.orderAlias.create({ data: { orderId: order.id, aliasNo: order.orderNo.toLowerCase() } });
  const receipt = await db.receipt.create({ data: { orderId: order.id, customerId, orderNo: order.orderNo, usd,
    status: 'RECEIVED', isDeposit: true, createdBy: admin.id } });
  return { order, receipt };
}
function snapshot(customerId: string, orders: Array<{ id: string; orderNo: string }>, total = '500.00'): FinancialSnapshot {
  return { invoiceBatchId: id(), invoiceNo: id(), currency: 'USD', invoiceTotal: total, customers: [{
    billingGroupId: id(), muledgerCustomerId: customerId, goodsAmount: total, adjustmentAmount: '0.00', freightAmount: '0.00', totalAmount: total,
    orderRefs: orders.map(row => ({ binding: { type: 'LEDGER_ORDER', id: row.id }, sourceOrderNo: row.orderNo, displayOrderNo: row.orderNo })),
  }] };
}
async function reserve(input: FinancialSnapshot) {
  const quote = await previewPrepayments({ schemaVersion: 2, snapshot: input });
  return reservePrepayments({ schemaVersion: 2, requestId: id(), mode: 'RECALCULATE', snapshot: quote.snapshot,
    expectedRevision: quote.revision, previousPlan: quote.previousPlan });
}
function generation(plan: PlanResponse, publicationSequence = 1, next = plan.snapshot) {
  return { schemaVersion: 2, source: 'MUCONT', generationId: id(), publicationSequence, documentVersion: publicationSequence,
    generatedAt: new Date().toISOString(), snapshot: next, plan: plan.plan,
    customerSnapshots: next.customers.map(group => ({ billingGroupId: group.billingGroupId, customerSnapshot: { mark: 'TEST', name: 'Synthetic', phone: null, city: null } })) };
}

test('combined pools survive REUSE; new receipt matching points at the combined invoice', async () => {
  const customer = await client(); const a = await pool(customer.id, 1000); const b = await pool(customer.id, 2000);
  const plan = await reserve(snapshot(customer.id, [a.order, b.order], '2100.00'));
  const applied = await acceptPrepaymentGeneration(generation(plan));
  const target = await db.order.findFirstOrThrow({ where: { invoiceId: applied.ledgerInvoiceId! } });
  const before = await db.prepaymentAllocation.findMany({ where: { invoiceBatchId: plan.snapshot.invoiceBatchId, state: 'APPLIED' } });
  await acceptPrepaymentGeneration(generation(plan, 2));
  expect(await db.prepaymentAllocation.findMany({ where: { invoiceBatchId: plan.snapshot.invoiceBatchId, state: 'APPLIED' } })).toEqual(before);
  expect(await findOrderIdByNoOrAliasWithExecutor(db, a.order.orderNo)).toBe(target.id);
  expect((await mapOrderIdsByOrderNosWithExecutor(db, [b.order.orderNo])).get(b.order.orderNo.toLowerCase())).toBe(target.id);
  expect((await db.order.findUniqueOrThrow({ where: { id: a.order.id } })).amount.toFixed(2)).toBe('0.00');
});

test('a new excess receipt on a combined invoice retains original source eligibility for a later batch', async () => {
  const customer = await client(); const a = await pool(customer.id, 1000); const b = await pool(customer.id, 2000);
  const first = await reserve(snapshot(customer.id, [a.order, b.order], '2100.00'));
  const applied = await acceptPrepaymentGeneration(generation(first));
  const combined = await db.order.findFirstOrThrow({ where: { invoiceId: applied.ledgerInvoiceId! } });
  const extra = await runFinancialTransaction(tx => tx.receipt.create({ data: { orderId: combined.id, orderNo: combined.orderNo,
    customerId: customer.id, usd: 1200, status: 'RECEIVED', createdBy: admin.id } }));
  const secondInput = structuredClone(first.snapshot); secondInput.invoiceBatchId = id(); secondInput.invoiceNo = id();
  secondInput.invoiceTotal = secondInput.customers[0].goodsAmount = secondInput.customers[0].totalAmount = '1500.00';
  secondInput.customers[0].billingGroupId = id();
  secondInput.customers[0].orderRefs.forEach(ref => { ref.displayOrderNo += '-NEXT'; });
  const second = await reserve(secondInput); expect(second.groups[0].prepaymentAmount).toBe('1500.00');
  expect(second.groups[0].unusedAmount).toBe('600.00');
  expect(second.groups[0].allocations.some(line => line.receiptId === extra.id)).toBe(true);
  await acceptPrepaymentGeneration(generation(second));
  expect(await db.receipt.count({ where: { customerId: customer.id } })).toBe(3);
  expect(await db.receipt.findUniqueOrThrow({ where: { id: extra.id } })).toEqual(extra);
});

test('explicit same-customer empty pool joins a funded source without changing the empty original', async () => {
  const customer = await client(); const a = await pool(customer.id, 3000);
  const empty = await db.order.create({ data: { invoiceId: a.order.invoiceId, orderNo: id(), customerId: customer.id,
    amount: 0, orderBalance: 0, createdBy: admin.id } });
  const input = snapshot(customer.id, [a.order, empty], '2100.00');
  input.customers[0].goodsAmount = '2000.00'; input.customers[0].freightAmount = '100.00';
  const plan = await reserve(input); expect(plan.groups[0].prepaymentAmount).toBe('2100.00');
  expect(plan.groups[0].unusedAmount).toBe('900.00');
  const applied = await acceptPrepaymentGeneration(generation(plan));
  const target = await db.order.findFirstOrThrow({ where: { invoiceId: applied.ledgerInvoiceId! } });
  expect(target.amount.toFixed(2)).toBe('2100.00'); expect(target.orderBalance.toFixed(2)).toBe('0.00');
  expect(await db.order.findUniqueOrThrow({ where: { id: empty.id } })).toEqual(empty);
  expect(await db.receipt.count({ where: { orderId: empty.id } })).toBe(0);
  expect(await findOrderIdByNoOrAliasWithExecutor(db, empty.orderNo)).toBe(target.id);
  expect(await db.receipt.findUniqueOrThrow({ where: { id: a.receipt.id } })).toEqual(a.receipt);
  await acceptPrepaymentGeneration(generation(plan, 2));
});

test('local amount/display edits preserve funds, reject below paid, and frozen manual resync restores source', async () => {
  const customer = await client(); const original = await pool(customer.id);
  const plan = await reserve(snapshot(customer.id, [original.order])); const payload = generation(plan);
  const applied = await acceptPrepaymentGeneration(payload);
  const link = await db.mucontInvoiceGroup.findFirstOrThrow({ where: { invoiceBatchId: plan.snapshot.invoiceBatchId } });
  const allocations = await db.prepaymentAllocation.findMany({ where: { orderId: link.orderId, state: 'APPLIED' } });
  await editSourceInvoiceOrder(admin, { orderId: link.orderId, amount: 700, orderNo: id() });
  expect((await db.order.findUniqueOrThrow({ where: { id: link.orderId } })).orderBalance.toFixed(2)).toBe('200.00');
  await expect(editSourceInvoiceOrder(admin, { orderId: link.orderId, amount: 499 })).rejects.toMatchObject({ status: 409 });
  const invoice = await requireWholeInvoice(admin, applied.ledgerInvoiceId!, true);
  const intent = { requestId: id(), expectedRevision: invoiceRevision(invoice), invoiceId: invoice.id, user: admin };
  const response = await acceptPrepaymentGeneration(payload, intent);
  expect((await db.mucontInvoiceResync.findUniqueOrThrow({ where: { requestId: intent.requestId } })).result).toEqual(response);
  expect(await acceptPrepaymentGeneration(payload, intent)).toEqual(response);
  expect((await db.order.findUniqueOrThrow({ where: { id: link.orderId } })).amount.toFixed(2)).toBe('500.00');
  expect(await db.prepaymentAllocation.findMany({ where: { orderId: link.orderId, state: 'APPLIED' } })).toEqual(allocations);
  expect(await db.receipt.findUniqueOrThrow({ where: { id: original.receipt.id } })).toEqual(original.receipt);
});

test('recalculation retains original applied dates when reducing a plan', async () => {
  const customer = await client(); const original = await pool(customer.id);
  const plan = await reserve(snapshot(customer.id, [original.order])); await acceptPrepaymentGeneration(generation(plan));
  const old = await db.prepaymentAllocation.findFirstOrThrow({ where: { planId: plan.plan.planId, state: 'APPLIED' } });
  const input = structuredClone(plan.snapshot); input.invoiceTotal = input.customers[0].goodsAmount = input.customers[0].totalAmount = '300.00';
  const next = await reserve(input); await acceptPrepaymentGeneration(generation(next, 2));
  const row = await db.prepaymentAllocation.findFirstOrThrow({ where: { planId: next.plan.planId, state: 'APPLIED' } });
  expect(row.amount.toFixed(2)).toBe('300.00'); expect(row.appliedAt).toEqual(old.appliedAt);
});

test('source binding without any durable source cannot combine financial A with tracker/name B', async () => {
  const customer = await client(); const a = await pool(customer.id); const b = await pool(customer.id);
  await db.orderTracker.create({ data: { orderNo: b.order.orderNo, normalizedOrderNo: b.order.orderNo.toUpperCase(),
    customerId: customer.id, financeOrderId: b.order.id, createdBy: admin.id } });
  const input = snapshot(customer.id, [a.order]); input.customers[0].orderRefs[0].sourceOrderNo = b.order.orderNo;
  await expect(previewPrepayments({ schemaVersion: 2, snapshot: input })).rejects.toMatchObject({ status: 409 });
  expect(await db.prepaymentSource.count({ where: { customerId: customer.id } })).toBe(0);
});

test('pending deletion prevents generation and no partial financial write remains', async () => {
  const customer = await client(); const original = await pool(customer.id); const plan = await reserve(snapshot(customer.id, [original.order]));
  await db.deletionRequest.create({ data: { targetType: 'RECEIPT', targetId: original.receipt.id, requestedBy: admin.id } });
  await expect(acceptPrepaymentGeneration(generation(plan))).rejects.toMatchObject({ status: 409 });
  expect(await db.invoice.count({ where: { invNo: plan.snapshot.invoiceNo } })).toBe(0);
  await releasePrepaymentPlan(plan.plan.planId, { schemaVersion: 2, requestId: id(), expectedVersion: plan.plan.version, reason: 'Isolated test' });
});

test('transfer unused funds across customers into an unbilled order, then use it once without copying income', async () => {
  const customer = await client(); const original = await pool(customer.id); const plan = await reserve(snapshot(customer.id, [original.order]));
  await acceptPrepaymentGeneration(generation(plan));
  const targetCustomer = await client(); const no = id();
  const tracker = await db.orderTracker.create({ data: { orderNo: no, normalizedOrderNo: no.toUpperCase(), customerId: targetCustomer.id, createdBy: admin.id } });
  const credit = (await listPrepaymentCredits(admin)).credits.find(row => row.receiptId === original.receipt.id)!;
  expect(credit.availableAmount).toBe('2500.00');
  const body = { requestId: id(), creditId: credit.creditId, expectedRevision: credit.revision, targetCustomerId: targetCustomer.id,
    targetBinding: { type: 'LEDGER_TRACKER', id: tracker.id }, amount: '1000.00', reason: 'Synthetic explicit cross-customer transfer' };
  const transfer = await transferPrepayment(admin, body); expect(await transferPrepayment(admin, body)).toEqual(transfer);
  expect(await db.receipt.findUniqueOrThrow({ where: { id: original.receipt.id } })).toEqual(original.receipt);
  expect(await db.receipt.count({ where: { customerId: targetCustomer.id } })).toBe(0);
  const next = snapshot(targetCustomer.id, [], '600.00'); next.customers[0].orderRefs = [{ binding: { type: 'LEDGER_TRACKER', id: tracker.id }, sourceOrderNo: no, displayOrderNo: no }];
  const targetPlan = await reserve(next); expect(targetPlan.groups[0].prepaymentAmount).toBe('600.00');
  await acceptPrepaymentGeneration(generation(targetPlan));
  await expect(reversePrepaymentTransfer(admin, transfer.transferId, { requestId: id(), reason: 'Already used' })).rejects.toMatchObject({ status: 409 });
  const invoiceView = await listInvoiceRecords(admin, targetPlan.snapshot.invoiceNo);
  expect(invoiceView.data[0].invBalance).toBe(0);
  expect(invoiceView.data[0].orders[0]).not.toHaveProperty('paymentAllocations');
  expect(await db.receipt.count({ where: { customerId: targetCustomer.id } })).toBe(0);
  const total = await db.prepaymentCredit.aggregate({ where: { funding: { originalReceiptId: original.receipt.id } }, _sum: { amount: true } });
  expect(total._sum.amount).toEqual(new Prisma.Decimal(3000));
});

test('unused transfer reversal is idempotent and non-admin can view own credits but cannot transfer', async () => {
  const operator = await db.user.create({ data: { email: `${id()}@example.test`, password: 'synthetic-only', role: 'USER', level: 3, parentId: admin.id } });
  const customer = await client(operator.id); const original = await pool(customer.id);
  const plan = await reserve(snapshot(customer.id, [original.order])); await acceptPrepaymentGeneration(generation(plan));
  const credits = await listPrepaymentCredits(operator); expect(credits.canTransfer).toBe(false);
  const credit = credits.credits.find(row => row.receiptId === original.receipt.id)!; expect(credit.availableAmount).toBe('2500.00');
  const target = await client(); const no = id();
  const tracker = await db.orderTracker.create({ data: { orderNo: no, normalizedOrderNo: no.toUpperCase(), customerId: target.id, createdBy: admin.id } });
  const body = { requestId: id(), creditId: credit.creditId, expectedRevision: credit.revision, targetCustomerId: target.id,
    targetBinding: { type: 'LEDGER_TRACKER', id: tracker.id }, amount: '1000.00', reason: 'Synthetic reversible transfer' };
  await expect(transferPrepayment(operator, body)).rejects.toMatchObject({ status: 403 });
  const transfer = await transferPrepayment(admin, body);
  const reversal = { requestId: id(), reason: 'Synthetic reverse' };
  expect(await reversePrepaymentTransfer(admin, transfer.transferId, reversal)).toEqual(await reversePrepaymentTransfer(admin, transfer.transferId, reversal));
  expect((await listPrepaymentCredits(operator)).credits.find(row => row.creditId === credit.creditId)!.availableAmount).toBe('2500.00');
  expect((await listPrepaymentCredits(operator)).credits.every(row => row.customerId === customer.id)).toBe(true);
});

test('settings branch cleanup cannot partially delete an allocated receipt or its history', async () => {
  const operator = await db.user.create({ data: { email: `${id()}@example.test`, password: 'synthetic-only', role: 'USER', level: 3, parentId: admin.id } });
  const customer = await client(operator.id); const source = await pool(customer.id);
  await db.receipt.update({ where: { id: source.receipt.id }, data: { createdBy: operator.id } });
  const plan = await reserve(snapshot(customer.id, [source.order])); await acceptPrepaymentGeneration(generation(plan));
  const history = await db.receiptHistory.create({ data: { receiptId: source.receipt.id, usd: 3000, status: 'RECEIVED', createdBy: operator.id } });
  const before = await db.receipt.findUniqueOrThrow({ where: { id: source.receipt.id } });
  await expect(purgeBranchBusinessData(admin, { targetUserId: operator.id, password: 'Prepay-isolated-test-123!', modules: ['receipt'] }))
    .rejects.toMatchObject({ status: 409 });
  expect(await db.receipt.findUniqueOrThrow({ where: { id: source.receipt.id } })).toEqual(before);
  expect(await db.receiptHistory.findUniqueOrThrow({ where: { id: history.id } })).toEqual(history);
});

test('customer deletion cannot discard funding identity or receipt ownership', async () => {
  const customer = await client(); const original = await pool(customer.id);
  const plan = await reserve(snapshot(customer.id, [original.order]));
  await acceptPrepaymentGeneration(generation(plan));
  const root = await db.receiptFunding.findUniqueOrThrow({ where: { receiptId: original.receipt.id } });
  await expect(deleteCustomerRecord(admin, customer.id)).rejects.toMatchObject({ status: 409 });
  expect(await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).toEqual(customer);
  expect(await db.receiptFunding.findUniqueOrThrow({ where: { id: root.id } })).toEqual(root);
  expect(await db.receipt.findUniqueOrThrow({ where: { id: original.receipt.id } })).toEqual(original.receipt);
});

test('invoice, dashboard, history, email, WhatsApp, report and analytics use allocations without multiplying income', async () => {
  const customer = await client(); const original = await pool(customer.id);
  await db.receipt.update({ where: { id: original.receipt.id }, data: { date: new Date('2026-10-15T00:00:00Z') } });
  const plan = await reserve(snapshot(customer.id, [original.order]));
  const result = await acceptPrepaymentGeneration(generation(plan));
  const invoiceId = result.ledgerInvoiceId!;
  expect((await listInvoiceRecords(admin, plan.snapshot.invoiceNo)).data[0].invBalance).toBe(0);
  const dashboard = await getDashboardSummary(admin);
  expect(dashboard.customerOutstanding.some(row => row.customerId === customer.id)).toBe(false);
  const history = await readCustomerHistory({ customerId: customer.id });
  expect(history.data.orders.find(row => row.id === original.order.id)!.outstanding).toBe(0);
  expect(history.data.receipts).toHaveLength(1); expect(history.data.receipts[0].usd).toBe(3000);
  await runFinancialTransaction(tx => projectPaymentReceiptInTransaction(tx, { receiptId: original.receipt.id, actorId: admin.id }));
  const notification = await db.emailNotification.findUniqueOrThrow({ where: { eventKey: `PAYMENT_RECEIVED:${original.receipt.id}` } });
  expect(notification.currentSnapshot).toMatchObject({ orderBalance: 0, amount: 3000 });
  const whatsapp = await resolveWhatsAppSource(db, notification);
  expect(whatsapp?.snapshot).toMatchObject({ orderBalance: 0, amount: 3000 });
  const report = await exportReport(admin, 'excel'); const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(report.fileBuffer as unknown as ExcelJS.Buffer);
  const invoiceRow = workbook.getWorksheet('Invoices')!.getRows(2, workbook.getWorksheet('Invoices')!.rowCount - 1)!.find(row => row.getCell(1).value === plan.snapshot.invoiceNo)!;
  expect(invoiceRow.getCell(3).value).toBe(500); expect(invoiceRow.getCell(4).value).toBe(500); expect(invoiceRow.getCell(5).value).toBe(0);
  const capacity = await getCustomerAnalyticsDetail(admin, { metric: 'payment-capacity', customerId: customer.id, asOf: new Date('2026-11-11T00:00:00Z') });
  expect(capacity.detail).toMatchObject({ total: 3000, averageMonthly: 250 });
  const raw = await db.order.findMany({ where: { invoiceId }, include: { invoice: true, receipts: { include: { funding: true } },
    paymentAllocations: { where: { state: 'APPLIED' }, include: { funding: { include: { receipt: true } } } } } });
  const cycle = normalizeAnalyticsOrders(raw, 'payment-cycle');
  expect(cycle[0].receipts).toHaveLength(1); expect(Number(cycle[0].receipts[0].usd)).toBe(500);
});
