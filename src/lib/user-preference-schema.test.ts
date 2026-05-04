import fs from 'node:fs';
import path from 'node:path';

describe('user preference schema contract', () => {
  it('uses the primary key as the only uniqueness constraint for userId', () => {
    const schema = fs.readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    const migration = fs.readFileSync(
      path.join(process.cwd(), 'prisma/migrations/20260504103000_user_preference_image_compression/migration.sql'),
      'utf8',
    );

    expect(schema).toContain('model UserPreference');
    expect(schema).toContain('@@id([userId])');
    expect(schema).not.toContain('userId                        String   @unique');
    expect(migration).not.toContain('UNIQUE INDEX `UserPreference_userId_key`(`userId`)');
  });
});
