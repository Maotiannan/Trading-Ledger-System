import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import { db } from '@/lib/db';
import { cleanupExpiredStagedUploadedAssets, cleanupStaleSigningPendingReceipts } from '@/lib/uploaded-asset-maintenance';
import { restoreRecoveryEntry } from '@/lib/recovery-service';

const phase = process.env.MULEDGER_RELIABILITY_BACKUP_PHASE;
const root = process.env.MULEDGER_RELIABILITY_BACKUP_DIR;
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

beforeAll(() => {
  const url = new URL(process.env.DATABASE_URL || '');
  const expected = phase === 'restore' ? '/muledger_reliability_restore_test' : '/muledger_reliability_test';
  if (process.env.MULEDGER_RELIABILITY_ISOLATED !== 'true' || url.hostname !== '127.0.0.1'
    || url.pathname !== expected || !root || !path.resolve(root).startsWith(path.join(os.tmpdir(), 'muledger-reliability-backup-'))
    || !['seed', 'restore'].includes(phase || '')) throw new Error('Run via the isolated backup test script');
  process.env.UPLOAD_DIR = path.join(root, phase === 'restore' ? 'restored-media' : 'media');
});
afterAll(async () => { await db.$disconnect(); });

// This suite is opt-in: ordinary reliability runs must not silently create snapshots.
const backupTest = phase ? test : test.skip;
backupTest('database and media roundtrip preserves recovery identity, custody, deadlines and intent results', async () => {
  const manifestPath = path.join(root!, 'manifest.json');
  if (phase === 'seed') {
    const suffix = `backup-${Date.now()}`;
    const user = await db.user.create({ data: { email: `${suffix}@example.invalid`, password: 'not-a-login', role: 'ADMIN', level: 1, sessionVersion: 3 } });
    const invoice = await db.invoice.create({ data: { invNo: suffix, createdBy: user.id, managedById: user.id } });
    const order = await db.order.create({ data: { orderNo: suffix, invoiceId: invoice.id, amount: 100, orderBalance: 100, createdBy: user.id, managedById: user.id } });
    const receipt = await db.receipt.create({ data: { receiptNo: suffix, orderId: order.id, usd: 20, status: 'SIGNING_PENDING', createdBy: user.id, managedById: user.id } });
    const session = await db.receiptGeneratorSession.create({ data: { receiptId: receipt.id, receiptNo: suffix, orderNo: suffix, usd: 20,
      createdBy: user.id, createdAt: new Date(Date.now() - 100 * 3600000) } });
    await db.receiptHistory.create({ data: { receiptId: receipt.id, usd: 20, status: 'SIGNING_PENDING', createdBy: user.id } });
    await mkdir(process.env.UPLOAD_DIR!, { recursive: true });
    const name = `${suffix}.png`;
    const bytes = Buffer.from('isolated backup original bytes');
    await writeFile(path.join(process.env.UPLOAD_DIR!, name), bytes);
    const asset = await db.uploadedAsset.create({ data: { path: `/upload/images/${name}`, name, category: 'RECEIPT_DIRECT',
      mimeType: 'image/png', sizeBytes: bytes.length, createdBy: user.id, managedById: user.id, expiresAt: new Date(Date.now() - 1000) } });
    await db.mutationIntent.create({ data: { id: suffix, actorId: user.id, kind: 'backup-test', fingerprint: 'test', completed: true, result: { resultId: receipt.id } } });
    await cleanupExpiredStagedUploadedAssets();
    await cleanupStaleSigningPendingReceipts();
    const entries = await db.recoveryEntry.findMany({ where: { resourceId: { in: [asset.id, receipt.id] } }, orderBy: { id: 'asc' } });
    expect(entries).toHaveLength(2);
    await writeFile(manifestPath, JSON.stringify({ userId: user.id, orderId: order.id, receiptId: receipt.id, sessionId: session.id,
      assetId: asset.id, name, hash: digest(bytes), intentId: suffix, entries }));
    return;
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const user = await db.user.findUniqueOrThrow({ where: { id: manifest.userId } });
  expect(user.sessionVersion).toBe(3);
  expect((await db.order.findUniqueOrThrow({ where: { id: manifest.orderId } })).managedById).toBe(user.id);
  expect(digest(await readFile(path.join(process.env.UPLOAD_DIR!, manifest.name)))).toBe(manifest.hash);
  const entries = await db.recoveryEntry.findMany({ where: { id: { in: manifest.entries.map((entry: { id: string }) => entry.id) } }, orderBy: { id: 'asc' } });
  expect(JSON.parse(JSON.stringify(entries))).toEqual(manifest.entries);
  expect((await db.mutationIntent.findUniqueOrThrow({ where: { id: manifest.intentId } })).result).toEqual({ resultId: manifest.receiptId });
  for (const entry of entries) {
    await expect(restoreRecoveryEntry(user, entry.id)).resolves.toMatchObject({ restored: true, alreadyRestored: false });
    await expect(restoreRecoveryEntry(user, entry.id)).resolves.toMatchObject({ alreadyRestored: true });
  }
  expect((await db.receipt.findUniqueOrThrow({ where: { id: manifest.receiptId } })).orderId).toBe(manifest.orderId);
  expect((await db.receiptGeneratorSession.findUniqueOrThrow({ where: { id: manifest.sessionId } })).receiptId).toBe(manifest.receiptId);
  expect(await db.receiptHistory.count({ where: { receiptId: manifest.receiptId } })).toBe(1);
  expect((await db.uploadedAsset.findUniqueOrThrow({ where: { id: manifest.assetId } })).status).toBe('STAGED');
});
