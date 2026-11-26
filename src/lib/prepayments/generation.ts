import { acceptInvoiceGeneration, previewInvoiceGeneration, type ManualIntent } from '@/lib/integrations/mucont-invoice-service';
import type { CurrentUser } from '@/lib/request-auth';
import { db } from '@/lib/db';
import type { DbTransactionClient } from '@/lib/transaction';
import { generationRequestSchema, generationResponseSchema, conflict } from './contract';
import { applyPlan, validatePlanForApplication, planFundingPools } from './service';
import { authorizeAllocationWrite } from './write-context';

export function parsePrepaymentGeneration(input: unknown) {
  const body = generationRequestSchema.parse(input);
  const texts = new Map(body.customerSnapshots.map(row => [row.billingGroupId, row.customerSnapshot]));
  if (texts.size !== body.snapshot.customers.length || body.customerSnapshots.length !== texts.size
    || body.snapshot.customers.some(group => !texts.has(group.billingGroupId))) conflict('Customer snapshots must match all billing groups.');
  const legacy = { schemaVersion: 1, source: 'MUCONT', generationId: body.generationId, publicationSequence: body.publicationSequence,
    generatedAt: body.generatedAt, documentVersion: body.documentVersion, ...body.snapshot,
    customers: body.snapshot.customers.map(group => ({ ...group, customerSnapshot: texts.get(group.billingGroupId),
      orderRefs: group.orderRefs.map(ref => ({ sourceOrderNo: ref.sourceOrderNo, displayOrderNo: ref.displayOrderNo })) })) };
  return { body, legacy };
}

export async function previewPrepaymentGeneration(user: CurrentUser, input: unknown, tx: DbTransactionClient = db) {
  const { body, legacy } = parsePrepaymentGeneration(input);
  const previous = await tx.mucontInvoiceGeneration.findUnique({ where: { generationId: body.generationId }, select: { generationId: true } });
  if (previous) return previewInvoiceGeneration(user, legacy, tx, { rawInput: body, fundingPools: [] });
  await validatePlanForApplication(tx, body.plan, body.snapshot);
  return previewInvoiceGeneration(user, legacy, tx, { rawInput: body, fundingPools: await planFundingPools(tx, body.snapshot) });
}

export async function acceptPrepaymentGeneration(input: unknown, manual?: ManualIntent, historyUser?: CurrentUser) {
  const { body, legacy } = parsePrepaymentGeneration(input);
  const result = await acceptInvoiceGeneration(legacy, manual, historyUser, {
    rawInput: body,
    formatResponse: response => generationResponseSchema.parse({ ...response, schemaVersion: 2, plan: body.plan }),
    beforeApply: async tx => {
      await validatePlanForApplication(tx, body.plan, body.snapshot);
      const pools = await planFundingPools(tx, body.snapshot);
      authorizeAllocationWrite(tx);
      return pools;
    },
    afterApply: async (tx, invoiceId, actorId) => { await applyPlan(tx, body.plan, invoiceId, actorId); },
  });
  const { revision, ...response } = result as Record<string, unknown>;
  const parsed = generationResponseSchema.parse({ ...response, schemaVersion: 2, plan: body.plan });
  return { ...parsed, ...(manual && typeof revision === 'string' ? { revision } : {}) };
}
