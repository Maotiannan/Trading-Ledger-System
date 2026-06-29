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

  it('stores dashboard layout preferences on the account preference row', () => {
    const schema = fs.readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    const migration = fs.readFileSync(
      path.join(process.cwd(), 'prisma/migrations/20260608090000_user_dashboard_layout_preference/migration.sql'),
      'utf8',
    );

    expect(schema).toContain('dashboardLayout');
    expect(schema).toContain('dashboardLayout               Json?');
    expect(migration).toContain('ADD COLUMN `dashboardLayout` JSON NULL');
  });

  it('stores list page size preferences on the account preference row', () => {
    const schema = fs.readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    const migration = fs.readFileSync(
      path.join(process.cwd(), 'prisma/migrations/20260629120000_user_list_page_size_preference/migration.sql'),
      'utf8',
    );

    expect(schema).toContain('listPageSizes');
    expect(schema).toContain('listPageSizes                 Json?');
    expect(migration).toContain('ADD COLUMN `listPageSizes` JSON NULL');
  });
});
