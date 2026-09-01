import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const schemaPath = path.join(rootDir, 'prisma/schema.prisma');
const migrationPath = path.join(
  rootDir,
  'prisma/migrations/20260901120000_admin_approved_email_notifications/migration.sql',
);

describe('customer email notification schema contract', () => {
  it('defines the durable email aggregate and stable deduplication keys', () => {
    const schema = readFileSync(schemaPath, 'utf8');

    expect(schema).toContain('enum CustomerEmailLanguage');
    expect(schema).toContain('enum EmailRecipientMode');
    expect(schema).toContain('enum EmailNotificationType');
    expect(schema).toContain('enum EmailNotificationStatus');
    expect(schema).toContain('enum EmailDeliveryStatus');
    expect(schema).toContain('enum EmailAttemptStatus');
    expect(schema).toContain('notificationLanguage CustomerEmailLanguage @default(ENGLISH)');

    for (const model of [
      'CustomerNotificationEmail',
      'EmailTemplate',
      'EmailNotification',
      'EmailDelivery',
      'EmailDeliveryAttempt',
      'EmailWebhookEvent',
    ]) {
      expect(schema).toContain(`model ${model}`);
    }

    expect(schema).toContain('@@unique([customerId, normalizedEmail])');
    expect(schema).toMatch(/eventKey\s+String\s+@unique/);
    expect(schema).toMatch(/idempotencyKey\s+String\s+@unique/);
    expect(schema).toMatch(/providerEventId\s+String\s+@unique/);
  });

  it('uses an additive migration that does not rewrite core business records', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

    expect(migration).toContain('CREATE TABLE `CustomerNotificationEmail`');
    expect(migration).toContain('CREATE TABLE `EmailNotification`');
    expect(migration).not.toMatch(
      /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM `(?:Customer|Receipt|Invoice|Order)`/i,
    );
  });
});
