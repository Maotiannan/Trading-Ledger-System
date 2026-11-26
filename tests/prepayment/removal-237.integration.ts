import { db } from '@/lib/db';
import { previewPrepayments, reservePrepayments } from '@/lib/prepayments/service';
import { acceptPrepaymentGeneration, previewPrepaymentGeneration } from '@/lib/prepayments/generation';
import { invoiceRevision, requireWholeInvoice } from '@/lib/integrations/mucont-invoice-service';
import type { CurrentUser } from '@/lib/request-auth';

beforeAll(() => {
  if (process.env.DATABASE_URL !== 'mysql://root:isolated237-only@127.0.0.1:3323/muledger237_test') throw Error('Isolated 237 DB required');
  process.env.MUCONT_INVOICE_ACTOR_ID = 'isolated237-admin';
});
afterAll(async () => db.$disconnect());
test('manual resync and historical preview accept the already-applied removal without reactivating canceled groups', async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { id: 'isolated237-admin' } }) as CurrentUser;
  const run = `resync237-${Date.now()}`;
  const customer = await db.customer.create({ data: { mark: run, normalizedMark: run, name: run, orderName: run, phone: '', city: '', ownerId: admin.id, createdBy: admin.id } });
  const other = await db.customer.create({ data: { mark: `${run}-other`, normalizedMark: `${run}-other`, name: run, orderName: `${run}-other`, phone: '', city: '', ownerId: admin.id, createdBy: admin.id } });
  const groups = ['a', 'b'].map((id, index) => ({ billingGroupId: `${run}-${id}`, muledgerCustomerId: index ? other.id : customer.id,
    orderRefs: [{ binding: null, sourceOrderNo: `${run}-${id}`, displayOrderNo: `${run}-${id}` }],
    goodsAmount: '100.00', freightAmount: '0.00', adjustmentAmount: '0.00', totalAmount: '100.00' }));
  const snapshot = { invoiceBatchId: run, invoiceNo: run, currency: 'USD', invoiceTotal: '200.00', customers: groups };
  async function publication(input: unknown, seq: number) {
    const quote = await previewPrepayments({ schemaVersion: 2, snapshot: input });
    const plan = await reservePrepayments({ schemaVersion: 2, requestId: `${run}-reserve-${seq}`, mode: 'RECALCULATE',
      snapshot: quote.snapshot, expectedRevision: quote.revision, previousPlan: quote.previousPlan });
    const body = { schemaVersion: 2, source: 'MUCONT', generationId: `${run}-gen-${seq}`, publicationSequence: seq, documentVersion: seq,
      generatedAt: new Date().toISOString(), snapshot: plan.snapshot, plan: plan.plan,
      customerSnapshots: plan.groups.map(g => ({ billingGroupId: g.billingGroupId, customerSnapshot: { mark: run, name: run, phone: null, city: null } })) };
    const ack = await acceptPrepaymentGeneration(body);
    return { body, invoiceId: ack.ledgerInvoiceId! };
  }
  const first = await publication(snapshot, 1);
  const second = await publication({ ...first.body.snapshot, customers: [first.body.snapshot.customers[1]], invoiceTotal: '100.00',
    groupChanges: { version: 1, expectedPublicationSequence: 1, removedBillingGroupIds: [groups[0].billingGroupId], cancelInvoice: false } }, 2);
  const removedBefore = await db.mucontInvoiceGroup.findUniqueOrThrow({ where: { invoiceBatchId_billingGroupId: { invoiceBatchId: run, billingGroupId: groups[0].billingGroupId } }, include: { order: true } });
  expect((await previewPrepaymentGeneration(admin, second.body)).result).toBe('ALREADY_PROCESSED');
  const whole = await requireWholeInvoice(admin, second.invoiceId, true);
  const manual = { user: admin, invoiceId: second.invoiceId, requestId: `${run}-manual`, expectedRevision: invoiceRevision(whole) };
  const result = await acceptPrepaymentGeneration(second.body, manual);
  expect(result.result).toBe('APPLIED');
  expect(await acceptPrepaymentGeneration(second.body, manual)).toEqual(result);
  expect(await db.order.findUniqueOrThrow({ where: { id: removedBefore.orderId } })).toEqual(removedBefore.order);
  expect(await db.auditLog.count({ where: { targetId: removedBefore.orderId, action: 'MUCONT_GROUP_CANCELED' } })).toBe(1);
  const third = await publication({ ...second.body.snapshot, customers: [], invoiceTotal: '0.00',
    groupChanges: { version: 1, expectedPublicationSequence: 2, removedBillingGroupIds: [groups[1].billingGroupId], cancelInvoice: true } }, 3);
  expect((await previewPrepaymentGeneration(admin, third.body)).result).toBe('ALREADY_PROCESSED');
  expect((await acceptPrepaymentGeneration(third.body, undefined, admin)).result).toBe('DUPLICATE');
  const canceled = await requireWholeInvoice(admin, third.invoiceId, true);
  expect(canceled.canceledAt).not.toBeNull();
  expect((await acceptPrepaymentGeneration(third.body, { user: admin, invoiceId: third.invoiceId,
    requestId: `${run}-manual-canceled`, expectedRevision: invoiceRevision(canceled) })).result).toBe('APPLIED');
  expect((await db.invoice.findUniqueOrThrow({ where: { id: third.invoiceId } })).canceledAt).toEqual(canceled.canceledAt);
  expect(await db.order.count({ where: { invoiceId: third.invoiceId, canceledAt: null } })).toBe(0);
});
