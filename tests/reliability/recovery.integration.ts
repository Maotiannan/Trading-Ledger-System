import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'fs/promises';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { cleanupExpiredStagedUploadedAssets, cleanupStaleSigningPendingReceipts } from '@/lib/uploaded-asset-maintenance';
import { recoveryDeadline, restoreRecoveryEntry, purgeExpiredRecoveryEntries, listRecoveryEntries } from '@/lib/recovery-service';
import { attachUploadedAssetByPath } from '@/lib/uploaded-asset-service';
import { finalizeReceiptGeneratorSession } from '@/lib/receipt-generator-service';
import { createSessionToken } from '@/lib/session';
import { GET, POST } from '@/app/api/recovery/route';
import { GET as listReceipts } from '@/app/api/receipt/route';
import { getReceiptGeneratorSession, getOpenReceiptGeneratorSessionByReceipt } from '@/lib/receipt-generator-read-service';
import { getDashboardSummary } from '@/lib/dashboard-summary-service';

let actor: Awaited<ReturnType<typeof db.user.create>>;
let uploadDir: string;
let serial = 0;
const label = () => `recovery-${Date.now()}-${++serial}`;
const now = () => new Date();

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL || '');
  if (process.env.MULEDGER_RELIABILITY_ISOLATED !== 'true' || url.hostname !== '127.0.0.1' || url.pathname !== '/muledger_reliability_test') throw Error('Not an isolated test database');
  uploadDir = await mkdtemp(path.join(os.tmpdir(), 'muledger-reliability-recovery-'));
  process.env.UPLOAD_DIR = uploadDir;
  actor = await db.user.create({ data: { email: `${label()}@example.invalid`, password: 'not-a-login', role: 'ADMIN', level: 1 } });
});
afterAll(async () => { await db.$disconnect(); if (uploadDir) await rm(uploadDir, { recursive: true, force: true }); });

async function staged() {
  const name = `${label()}.png`;
  await mkdir(path.join(uploadDir, 'receipts/direct'), { recursive: true });
  await writeFile(path.join(uploadDir, 'receipts/direct', name), 'isolated-original-media');
  return db.uploadedAsset.create({ data: {
    path: `/upload/images/receipts/direct/${name}`, name, category: 'RECEIPT_DIRECT', mimeType: 'image/png', sizeBytes: 23,
    createdBy: actor.id, expiresAt: new Date(Date.now() - 1000),
  } });
}

async function pending() {
  const invoice = await db.invoice.create({ data: { invNo: label(), createdBy: actor.id } });
  const order = await db.order.create({ data: { invoiceId: invoice.id, orderNo: label(), amount: 100, orderBalance: 100, createdBy: actor.id } });
  const receipt = await db.receipt.create({ data: { orderId: order.id, orderNo: order.orderNo, receiptNo: label(), usd: 25,
    status: 'SIGNING_PENDING', createdBy: actor.id } });
  const session = await db.receiptGeneratorSession.create({ data: { receiptId: receipt.id, receiptNo: receipt.receiptNo!,
    orderNo: order.orderNo, usd: 25, createdBy: actor.id, createdAt: new Date(Date.now() - 100 * 3600000) } });
  return { receipt, session, order };
}

const image = () => new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lV8AAAAASUVORK5CYII=', 'base64')], 'test.png', { type: 'image/png' });
const finalize = (id: string) => finalizeReceiptGeneratorSession(actor, { sessionId: id, receiptImage: image(), receiverSignature: image(), payerSignature: image() });

test('a staged asset bound after cleanup scan is not deleted', async () => {
  const asset = await staged();
  const original = db.uploadedAsset.findMany.bind(db.uploadedAsset);
  let scanned!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((r) => { scanned = r; });
  const gate = new Promise<void>((r) => { release = r; });
  const spy = jest.spyOn(db.uploadedAsset, 'findMany').mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
    const rows = await original(args); scanned(); await gate; return rows;
  }) as typeof original);
  const cleanup = cleanupExpiredStagedUploadedAssets();
  try {
    await ready;
    await attachUploadedAssetByPath({ path: asset.path, attachedType: 'RECEIPT', attachedId: 'test-attachment' });
  } finally { release(); spy.mockRestore(); }
  await cleanup;
  expect((await db.uploadedAsset.findUniqueOrThrow({ where: { id: asset.id } })).status).toBe('ATTACHED');
  expect(await db.recoveryEntry.count({ where: { resourceId: asset.id } })).toBe(0);
});

test('cleanup archives media once, keeps hash/deadline, and restores atomically and idempotently', async () => {
  const asset = await staged();
  const at = now();
  await cleanupExpiredStagedUploadedAssets({ now: at });
  await cleanupExpiredStagedUploadedAssets({ now: new Date(at.getTime() + 1000) });
  const entries = await db.recoveryEntry.findMany({ where: { resourceId: asset.id } });
  expect(entries).toHaveLength(1);
  expect(entries[0].recoverableUntil.getTime() - at.getTime()).toBe(15 * 86400000);
  const bytes = await readFile(path.join(uploadDir, asset.path.replace('/upload/images/', '')));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(createHash('sha256').update('isolated-original-media').digest('hex'));
  await expect(restoreRecoveryEntry(actor, entries[0].id)).resolves.toMatchObject({ restored: true, alreadyRestored: false });
  await expect(restoreRecoveryEntry(actor, entries[0].id)).resolves.toMatchObject({ restored: true, alreadyRestored: true });
  expect(await db.auditLog.count({ where: { targetId: entries[0].id, action: 'recovery.restored' } })).toBe(1);
});

test('signing completed after cleanup scan survives, and finalize updates the balance', async () => {
  const { session, receipt, order } = await pending();
  const original = db.receiptGeneratorSession.findMany.bind(db.receiptGeneratorSession);
  let scanned!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((r) => { scanned = r; });
  const gate = new Promise<void>((r) => { release = r; });
  const spy = jest.spyOn(db.receiptGeneratorSession, 'findMany').mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
    const rows = await original(args); scanned(); await gate; return rows;
  }) as typeof original);
  const cleanup = cleanupStaleSigningPendingReceipts();
  try { await ready; await finalize(session.id); } finally { release(); spy.mockRestore(); }
  await cleanup;
  expect((await db.receipt.findUniqueOrThrow({ where: { id: receipt.id } })).status).toBe('SR_Received');
  expect(Number((await db.order.findUniqueOrThrow({ where: { id: order.id } })).orderBalance)).toBe(75);
  expect(await db.recoveryEntry.count({ where: { resourceId: receipt.id } })).toBe(0);
});

test('two finalize attempts cannot delete the successful receipt artifacts', async () => {
  const { session, receipt } = await pending();
  const results = await Promise.allSettled([finalize(session.id), finalize(session.id)]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const saved = await db.receipt.findUniqueOrThrow({ where: { id: receipt.id } });
  expect(saved.status).toBe('SR_Received');
  expect((await stat(path.join(uploadDir, saved.imageUrl!.replace('/upload/images/', '')))).size).toBeGreaterThan(0);
});

test('an archived pending receipt is hidden and can restore its original identity and edit history', async () => {
  const { session, receipt, order } = await pending();
  await db.receiptHistory.create({ data: { receiptId: receipt.id, usd: 25, status: 'SIGNING_PENDING', createdBy: actor.id } });
  await cleanupStaleSigningPendingReceipts();
  expect(await db.receipt.findUnique({ where: { id: receipt.id } })).toBeNull();
  expect(await db.receiptGeneratorSession.findUnique({ where: { id: session.id } })).toBeNull();
  expect(Number((await db.order.findUniqueOrThrow({ where: { id: order.id } })).orderBalance)).toBe(100);
  const entry = await db.recoveryEntry.findFirstOrThrow({ where: { resourceId: receipt.id } });
  await restoreRecoveryEntry(actor, entry.id);
  expect((await db.receipt.findUniqueOrThrow({ where: { id: receipt.id } })).orderId).toBe(order.id);
  expect(await db.receiptHistory.count({ where: { receiptId: receipt.id } })).toBe(1);
  expect((await db.receiptGeneratorSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe('PENDING');
});

test('restore refuses missing files and expired entries; absent files do not block purge', async () => {
  const asset = await staged();
  await cleanupExpiredStagedUploadedAssets();
  const entry = await db.recoveryEntry.findFirstOrThrow({ where: { resourceId: asset.id } });
  await rm(path.join(uploadDir, asset.path.replace('/upload/images/', '')));
  await expect(restoreRecoveryEntry(actor, entry.id)).rejects.toMatchObject({ status: 409 });
  expect((await db.recoveryEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe('RECOVERABLE');
  await expect(restoreRecoveryEntry(actor, entry.id, entry.recoverableUntil)).rejects.toMatchObject({ status: 409 });
  const expired = new Date(entry.recoverableUntil.getTime() + 1);
  await purgeExpiredRecoveryEntries(expired);
  expect((await db.recoveryEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe('PURGED');
  expect(() => recoveryDeadline(now(), 16)).toThrow();
  expect(() => recoveryDeadline(now(), 0)).toThrow();
});

test('a real partial file deletion failure is recorded and retried without extending the deadline', async () => {
  const asset = await staged();
  await cleanupExpiredStagedUploadedAssets();
  const entry = await db.recoveryEntry.findFirstOrThrow({ where: { resourceId: asset.id } });
  const blockedPath = `/upload/images/receipts/direct/${label()}-directory.png`;
  const blockedAbsolute = path.join(uploadDir, blockedPath.replace('/upload/images/', ''));
  await mkdir(blockedAbsolute);
  await db.recoveryEntry.update({ where: { id: entry.id }, data: { files: [asset.path, blockedPath] } });
  const expired = new Date(entry.recoverableUntil.getTime() + 1);
  await purgeExpiredRecoveryEntries(expired);
  const failed = await db.recoveryEntry.findUniqueOrThrow({ where: { id: entry.id } });
  expect(failed.status).toBe('RECOVERABLE');
  expect(failed.lastError).toMatch(/EISDIR|directory/i);
  expect(failed.recoverableUntil).toEqual(entry.recoverableUntil);
  await expect(stat(path.join(uploadDir, asset.path.replace('/upload/images/', '')))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(restoreRecoveryEntry(actor, entry.id, expired)).rejects.toMatchObject({ status: 409 });
  await rm(blockedAbsolute, { recursive: true });
  await purgeExpiredRecoveryEntries(expired);
  const retried = await db.recoveryEntry.findUniqueOrThrow({ where: { id: entry.id } });
  expect(retried.status).toBe('PURGED');
  expect(retried.lastError).toBeNull();
  expect(retried.recoverableUntil).toEqual(entry.recoverableUntil);
});

test('cleanup winning first rejects stale binding and signing; ordinary endpoints hide the archived draft', async () => {
  const asset = await staged();
  const { session, receipt } = await pending();
  await cleanupExpiredStagedUploadedAssets();
  await expect(attachUploadedAssetByPath({ path: asset.path, attachedType: 'RECEIPT', attachedId: receipt.id })).rejects.toThrow();
  await cleanupStaleSigningPendingReceipts();
  await expect(finalize(session.id)).rejects.toMatchObject({ status: 404 });
  await expect(getReceiptGeneratorSession(actor, session.id)).rejects.toMatchObject({ status: 404 });
  await expect(getOpenReceiptGeneratorSessionByReceipt(actor, receipt.id)).rejects.toMatchObject({ status: 404 });
  const response = await listReceipts(new NextRequest(`http://isolated.local/api/receipt?search=${receipt.receiptNo}`, {
    headers: { cookie: `tls_session=${createSessionToken(actor.id)}` },
  }));
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual([]);
  const summary = await getDashboardSummary(actor);
  expect(summary.recentReceipts.some((row) => row.id === receipt.id)).toBe(false);
  const entry = await db.recoveryEntry.findFirstOrThrow({ where: { resourceId: receipt.id } });
  await restoreRecoveryEntry(actor, entry.id);
  await expect(finalize(session.id)).resolves.toBeDefined();
});

test('recovery access is isolated to the administrator management tree', async () => {
  const asset = await staged();
  await cleanupExpiredStagedUploadedAssets();
  const entry = await db.recoveryEntry.findFirstOrThrow({ where: { resourceId: asset.id } });
  const outsider = await db.user.create({ data: { email: `${label()}@example.invalid`, password: 'not-a-login', role: 'ADMIN', level: 1 } });
  expect(await listRecoveryEntries(outsider)).toEqual([]);
  await expect(restoreRecoveryEntry(outsider, entry.id)).rejects.toMatchObject({ status: 403 });
  expect((await db.recoveryEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe('RECOVERABLE');
});

test('recovery API rejects ordinary users and is available only to administrators', async () => {
  const user = await db.user.create({ data: { email: `${label()}@example.invalid`, password: 'not-a-login', parentId: actor.id } });
  const request = (id: string) => new NextRequest('http://isolated.local/api/recovery', { headers: { cookie: `tls_session=${createSessionToken(id)}` } });
  expect((await GET(request(user.id))).status).toBe(403);
  expect((await POST(new NextRequest('http://isolated.local/api/recovery', { method: 'POST', headers: { cookie: `tls_session=${createSessionToken(user.id)}`, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'not-real' }) }))).status).toBe(403);
  expect((await GET(request(actor.id))).status).toBe(200);
});
