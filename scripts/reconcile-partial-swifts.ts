import { db } from '../src/lib/db';
import { reconcilePartialSwiftStatuses } from '../src/lib/swift-status-reconciliation';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Explicit DATABASE_URL is required');
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const actorArg = args.find((arg) => arg.startsWith('--actor-id='));
  if (args.some((arg) => arg !== '--apply' && !arg.startsWith('--actor-id='))) throw new Error('Unknown argument');
  const result = await reconcilePartialSwiftStatuses({ apply, actorId: actorArg?.slice('--actor-id='.length) });
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'SWIFT status reconciliation failed');
  process.exitCode = 1;
}).finally(() => db.$disconnect());
