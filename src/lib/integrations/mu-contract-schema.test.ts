import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('MU Contract order sync persistence contract', () => {
  const schema = readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  const migrationPath = path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260718090000_mu_contract_order_sync',
    'migration.sql',
  );

  it('keeps official PI amount nullable and protects source/event identity', () => {
    expect(schema).toContain('model ExternalOrderSourceLink');
    expect(schema).toMatch(/officialAmount\s+Decimal\?/);
    expect(schema).toContain('@@unique([provider, externalId])');
    expect(schema).toContain('model IntegrationEventReceipt');
    expect(schema).toContain('@@unique([provider, eventId])');
  });

  it('models durable cursor, conflict, preview, and non-destructive archival state', () => {
    expect(schema).toContain('model IntegrationSyncState');
    expect(schema).toContain('model IntegrationSyncConflict');
    expect(schema).toContain('model IntegrationReconcilePreview');
    expect(schema).toMatch(/archivedAt\s+DateTime\?/);
    expect(schema).toMatch(/serviceActor\s+User\s+@relation\("IntegrationSyncServiceActor"[^\n]+onDelete: Restrict\)/);
  });

  it('uses an additive migration with no financial-table writes or destructive statements', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    expect(migration).toContain('CREATE TABLE `ExternalOrderSourceLink`');
    expect(migration).toContain('ALTER TABLE `OrderTracker`');
    expect(migration).not.toMatch(/\bDROP\b/i);
    expect(migration).not.toMatch(/\bUPDATE\s+`?(Order|Invoice|Receipt|Detail|Swift)`?\b/i);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
});
