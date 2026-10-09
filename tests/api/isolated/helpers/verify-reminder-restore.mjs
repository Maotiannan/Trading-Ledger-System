import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

export async function verifyReminderRestore(db, deliveryId) {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '3307');
  assert.equal(url.pathname, '/trading_ledger_test');
  assert.equal(process.env.WHATSAPP_OUTBOUND_ENABLED, 'false');
  assert.ok(process.env.UPLOAD_DIR.startsWith(os.tmpdir().replace(/\/$/, '')));
  const relative = 'whatsapp-statements/restore-fixture.png';
  const bytes = await readFile('public/detail-export/outstanding-reminder-sample.png');
  await mkdir(path.join(process.env.UPLOAD_DIR, 'whatsapp-statements'), { recursive: true });
  await writeFile(path.join(process.env.UPLOAD_DIR, relative), bytes);
  const expected = await db.whatsAppDelivery.update({ where: { id: deliveryId }, data: { statementImagePath: '/upload/images/' + relative } });
  const compose = ['compose', '-p', 'trading-ledger-system-test', '-f', 'docker-compose.test.yml', 'exec', '-T', 'mysql'];
  const sql = (query) => execFileSync('docker', [...compose, 'mariadb', '-uroot', '-prootpass', '-e', query]);
  const target = 'trading_ledger_reminder_restore_test';
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'reminder-restore-'));
  let restored;
  try {
    // No --databases flag: the dump contains no source-schema CREATE/USE statement.
    const dump = execFileSync('docker', [...compose, 'mariadb-dump', '-uroot', '-prootpass', '--single-transaction', 'trading_ledger_test'], { maxBuffer: 64 * 1024 * 1024 });
    sql(`CREATE DATABASE ${target}`);
    execFileSync('docker', [...compose, 'mariadb', '-uroot', '-prootpass', target], { input: dump, maxBuffer: 64 * 1024 * 1024 });
    url.pathname = '/' + target;
    restored = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    assert.deepEqual(await restored.whatsAppDelivery.findUniqueOrThrow({ where: { id: deliveryId } }), expected);
    const retries = await db.whatsAppDelivery.findMany({ where: { retryOf: { not: null } }, orderBy: { id: 'asc' } });
    assert.deepEqual(await restored.whatsAppDelivery.findMany({ where: { retryOf: { not: null } }, orderBy: { id: 'asc' } }), retries);
    for (const child of retries) {
      assert.deepEqual(await restored.whatsAppDelivery.findUniqueOrThrow({ where: { id: child.retryOf } }),
        await db.whatsAppDelivery.findUniqueOrThrow({ where: { id: child.retryOf } }));
    }
    execFileSync('tar', ['-czf', path.join(temporary, 'media.tgz'), '-C', process.env.UPLOAD_DIR, 'whatsapp-statements']);
    await mkdir(path.join(temporary, 'restored'));
    execFileSync('tar', ['-xzf', path.join(temporary, 'media.tgz'), '-C', path.join(temporary, 'restored')]);
    const actual = await readFile(path.join(temporary, 'restored', relative));
    const hash = value => createHash('sha256').update(value).digest('hex');
    assert.equal(hash(actual), hash(bytes));
  } finally {
    await restored?.$disconnect();
    sql(`DROP DATABASE IF EXISTS ${target}`);
    await rm(temporary, { recursive: true, force: true });
  }
}
