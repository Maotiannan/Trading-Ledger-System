/* eslint-disable @typescript-eslint/no-require-imports -- This compiler harness intentionally loads the TS contract as CommonJS. */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { z } = require('zod');

const file = path.resolve(__dirname, '../src/lib/prepayments/contract.ts');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = new Module(file, module);
mod.filename = file;
mod.paths = module.paths;
const load = mod.require.bind(mod);
mod.require = (name) => {
  if (name !== './group-changes-contract') return load(name);
  const dependency = path.join(path.dirname(file), 'group-changes-contract.ts');
  const child = new Module(dependency, mod);
  child.filename = dependency; child.paths = module.paths;
  child._compile(ts.transpileModule(fs.readFileSync(dependency, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, dependency);
  return child.exports;
};
mod._compile(compiled, file);
const schemas = Object.fromEntries(Object.entries(mod.exports.contractSchemas)
  .map(([name, schema]) => [name, z.toJSONSchema(schema, { target: 'draft-7' })]));
const snapshot = { invoiceBatchId: 'batch-example-01', invoiceNo: 'L26-EXAMPLE', currency: 'USD', invoiceTotal: '2100.00',
  customers: [{ billingGroupId: 'customer-local-01', muledgerCustomerId: 'customer-ledger-01',
    orderRefs: [{ binding: { type: 'MUCONT_PI', id: 'pi-ab-01' }, sourceOrderNo: 'AB-01', displayOrderNo: 'AB-01B' },
      { binding: { type: 'LEDGER_ORDER', id: 'pool-order-ab-02' }, sourceOrderNo: 'AB-02', displayOrderNo: 'AB-02B' }],
    goodsAmount: '2000.00', adjustmentAmount: '0.00', freightAmount: '100.00', totalAmount: '2100.00' }] };
const { canonicalHash, financialHash } = mod.exports;
const planSnapshot = structuredClone(snapshot);
planSnapshot.customers[0].orderRefs.forEach((ref, index) => { ref.binding = { type: 'LEDGER_SOURCE', id: `source-${index + 1}` }; });
const groups = [{ billingGroupId: 'customer-local-01', muledgerCustomerId: 'customer-ledger-01', totalAmount: '2100.00',
  paidBeforeAmount: '0.00', prepaymentAmount: '2100.00', paidAmount: '2100.00', remainingAmount: '0.00', unusedAmount: '900.00',
  allocations: [{ creditId: 'credit-example-01', receiptId: 'receipt-example-01', amount: '2100.00' }] }];
const planHashInput = { schemaVersion: 2, planId: 'plan-example-01', version: 1, financialHash: financialHash(planSnapshot),
  paymentSnapshotAt: '2026-11-11T10:00:00.000Z', snapshot: planSnapshot, groups };
const reference = { planId: planHashInput.planId, version: 1, hash: canonicalHash(planHashInput) };
const plan = { schemaVersion: 2, requestId: 'funding-request-example-01', plan: reference, state: 'RESERVED',
  financialHash: planHashInput.financialHash, paymentSnapshotAt: planHashInput.paymentSnapshotAt, snapshot: planSnapshot, groups, ledgerInvoiceId: null };
const renamed = structuredClone(planSnapshot);
renamed.invoiceNo = 'L26-RENAMED';
renamed.customers[0].orderRefs[0].displayOrderNo = 'AB-01C';
renamed.customers[0].orderRefs[0].sourceOrderNo = 'AB-01-RENAMED';
const caseSnapshot = structuredClone(planSnapshot);
const upper = structuredClone(caseSnapshot.customers[0]);
upper.billingGroupId = 'Customer-A'; upper.muledgerCustomerId = 'Customer-Ledger-A';
upper.orderRefs = [{ binding: { type: 'LEDGER_SOURCE', id: 'Source-Z' }, sourceOrderNo: 'ÉTÉ-01', displayOrderNo: 'ÉTÉ-01B' }];
caseSnapshot.customers = [caseSnapshot.customers[0], upper]; caseSnapshot.invoiceTotal = '4200.00';
const revision = canonicalHash({ example: 'preview-revision' });
const removed = { ...planSnapshot, invoiceTotal: '0.00', customers: [], groupChanges: {
  version: 1, expectedPublicationSequence: 1, removedBillingGroupIds: ['customer-local-01'], cancelInvoice: true,
} };
const contract = { contract: 'MULEDGER_PREPAYMENT_V2', revision: 4, status: 'PROPOSED_FOR_FREEZE', schemas,
  examples: { previewRequest: { schemaVersion: 2, snapshot },
    reserveRequest: { schemaVersion: 2, requestId: plan.requestId, mode: 'RECALCULATE', snapshot, expectedRevision: revision, previousPlan: null },
    reuseRequest: { schemaVersion: 2, requestId: 'reuse-example-01', mode: 'REUSE', snapshot: renamed, expectedRevision: null, previousPlan: reference },
    planResponse: plan,
    generationRequest: { schemaVersion: 2, source: 'MUCONT', generationId: 'generation-example-01', publicationSequence: 1,
      generatedAt: '2026-11-11T10:01:00.000Z', documentVersion: 2, snapshot: renamed, plan: reference,
      customerSnapshots: [{ billingGroupId: 'customer-local-01', customerSnapshot: { mark: 'AB', name: 'Été Client', phone: null, city: null } }] },
    generationResponse: { schemaVersion: 2, generationId: 'generation-example-01', invoiceBatchId: snapshot.invoiceBatchId,
      publicationSequence: 1, result: 'APPLIED', ledgerInvoiceId: 'ledger-invoice-example-01', plan: reference },
    releaseRequest: { schemaVersion: 2, requestId: 'cancel-example-01', expectedVersion: 1, reason: 'Cancelled before publication' },
    releasedPlanResponse: { ...plan, state: 'RELEASED' },
    errorResponse: { error: { code: 'PREPAYMENT_REVISION_CONFLICT', message: 'Available funds changed. Refresh the preview.', retryable: false } },
  }, hashVectors: { plan: { input: planHashInput, sha256: canonicalHash(planHashInput) },
    financial: [{ snapshot: planSnapshot, sha256: financialHash(planSnapshot) }, { snapshot: renamed, sha256: financialHash(renamed) },
      { snapshot: caseSnapshot, sha256: financialHash(caseSnapshot) }, { snapshot: removed, sha256: financialHash(removed) }],
    canonical: { input: { 'é': 'français', z: '中', A: '+86', a: 'receipt' }, sha256: canonicalHash({ 'é': 'français', z: '中', A: '+86', a: 'receipt' }) } } };
const target = process.argv[2];
if (!target) throw new Error('Provide an output filename.');
fs.writeFileSync(target, JSON.stringify(contract, null, 2) + '\n');
console.log(`Exported ${Object.keys(schemas).length} strict schemas to ${target}`);
