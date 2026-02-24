import { db } from '../src/lib/db';

async function main() {
  // 更新 SYSTEM_POOL 为 Un_Associated
  const result = await db.invoice.updateMany({
    where: { invNo: 'SYSTEM_POOL' },
    data: { invNo: 'Un_Associated' }
  });
  console.log(`Updated ${result.count} invoices from SYSTEM_POOL to Un_Associated`);
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
