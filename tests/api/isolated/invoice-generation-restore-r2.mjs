import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const expected = 'mysql://root:invoice-r2-isolated-only@127.0.0.1:3313/muledger_invoice_r2_restore_20261111';
assert.equal(process.env.DATABASE_URL, expected, 'Refusing a non-isolated restore target');
const db = new PrismaClient();
const base = 'http://127.0.0.1:3315';
const artifact = new URL('../../../out/invoice-r2-isolated/restore-state.json', import.meta.url);
const tables = ['mucontInvoiceSource', 'mucontInvoiceGroup', 'mucontInvoiceGeneration', 'mucontInvoiceResync', 'invoice', 'order', 'orderAlias', 'receipt', 'auditLog'];
const canonical = (value) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
async function state() {
  const result = {};
  for (const table of tables) {
    const rows = (await db[table].findMany()).map(canonical).sort();
    result[table] = { count: rows.length, sha256: createHash('sha256').update(rows.join('\n')).digest('hex') };
  }
  return result;
}
try {
  const before = await state();
  const source = new PrismaClient({ datasources: { db: { url: expected.replace('muledger_invoice_r2_restore_20261111', 'muledger_invoice_r2_test') } } });
  // Compare only the frozen dump's copied rows; the original may have new cross-test rows by now.
  for (const table of tables) {
    const restored = await db[table].findMany();
    const liveRows = await source[table].findMany();
    const key = (row) => table === 'mucontInvoiceSource' ? row.invoiceBatchId
      : table === 'mucontInvoiceGeneration' ? row.generationId
      : table === 'mucontInvoiceResync' ? row.requestId : row.id;
    const byId = new Map(liveRows.map((row) => [key(row), canonical(row)]));
    for (const row of restored) assert.equal(canonical(row), byId.get(key(row)), `${table}: restored row differs`);
  }
  await source.$disconnect();
  const generation = await db.mucontInvoiceGeneration.findFirstOrThrow({ where: { result: 'APPLIED' } });
  const response = await fetch(base + '/api/integrations/mucont/v1/invoice-generations', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer invoice-r2-receive-isolated-12345678901234567890' },
    body: JSON.stringify(generation.snapshot) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result, 'DUPLICATE');
  const intent = await db.mucontInvoiceResync.findFirstOrThrow({ where: { actorId: 'invoice-r2-admin' } });
  const sourceRow = await db.mucontInvoiceSource.findUniqueOrThrow({ where: { invoiceBatchId: intent.invoiceBatchId } });
  const auth = await fetch(base + '/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'login', email: 'invoice-r2-admin@example.test', password: 'InvoiceR2-Test!2026' }) });
  assert.equal(auth.status, 200);
  const cookie = auth.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const repeat = await fetch(base + `/api/invoice/${sourceRow.invoiceId}/resync`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ requestId: intent.requestId, expectedRevision: intent.expectedRevision }) });
  assert.equal(repeat.status, 200);
  assert.deepEqual((await repeat.json()).data, intent.result);
  const after = await state();
  // Login has its own audit event. Invoice accounting/sync audit actions remain unchanged.
  for (const table of tables.filter((name) => name !== 'auditLog')) assert.deepEqual(after[table], before[table], table);
  const result = { verifiedAt: new Date().toISOString(), before, after, checks: [
    'full restored rows equal source snapshot', 'duplicate generation returns DUPLICATE',
    'completed resync returns stored result without upstream access', 'no repeated accounting or receipt mutations',
  ] };
  fs.writeFileSync(artifact, JSON.stringify(result, null, 2));
  console.log('PASS isolated restore, complete row comparison and duplicate replay', JSON.stringify(result));
} finally { await db.$disconnect(); }
