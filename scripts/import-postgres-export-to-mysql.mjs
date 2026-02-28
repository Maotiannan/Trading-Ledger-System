#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const inputPath = process.argv[2] ?? 'migration/postgres-export.json';

const tableOrder = [
  'user',
  'invoice',
  'customer',
  'order',
  'receipt',
  'receiptHistory',
  'detail',
  'detailItem',
  'detailHistory',
  'swift',
  'deletionRequest',
  'balanceTransfer',
  'auditLog',
  'systemSetting',
];

const timestampFields = new Set(['date', 'createdAt', 'updatedAt', 'requestedAt', 'reviewedAt']);

function normalizeRecord(record) {
  const normalized = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined) {
      normalized[key] = value;
      continue;
    }
    if (typeof value === 'string' && timestampFields.has(key)) {
      normalized[key] = new Date(value);
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
}

async function main() {
  const absolutePath = path.resolve(inputPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Export file not found: ${absolutePath}`);
  }

  const raw = fs.readFileSync(absolutePath, 'utf8');
  const payload = JSON.parse(raw);

  await prisma.$connect();
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');

  try {
    for (const table of [...tableOrder].reverse()) {
      const delegate = prisma[table];
      if (!delegate?.deleteMany) {
        throw new Error(`Unknown Prisma model delegate: ${table}`);
      }
      await delegate.deleteMany({});
    }

    for (const table of tableOrder) {
      const rows = Array.isArray(payload[table]) ? payload[table] : [];
      if (rows.length === 0) {
        console.log(`[import] ${table}: 0 rows`);
        continue;
      }

      const data = rows.map(normalizeRecord);
      const delegate = prisma[table];
      await delegate.createMany({ data, skipDuplicates: false });
      console.log(`[import] ${table}: ${rows.length} rows`);
    }
  } finally {
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[import] failed:', error);
  process.exit(1);
});
