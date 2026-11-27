import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('production Docker image dependency contract', () => {
  const dockerfile = readFileSync(path.join(process.cwd(), 'Dockerfile'), 'utf8');

  it('uses the lockfile for deterministic dependency installation', () => {
    expect(dockerfile).toMatch(/RUN\s+npm ci(?:\s|$)/);
    expect(dockerfile).not.toMatch(/RUN\s+npm install(?:\s|$)/);
  });

  it('ships standalone with a separate locked migration CLI, not another full dependency tree', () => {
    const runner = dockerfile.split(/FROM[^\n]+ AS runner\n/)[1];
    expect(runner).toContain('COPY --from=builder /app/.next/standalone ./');
    expect(runner).not.toMatch(/COPY[^\n]+\/app\/node_modules\s+\.\/node_modules/);
    expect(dockerfile).toContain('dependencies:{prisma:p.dependencies.prisma}');
    expect(dockerfile).toMatch(/npm prune[^\n]+--omit=dev/);
    expect(runner).toContain('COPY --from=migration-cli /app/node_modules /opt/prisma-cli/node_modules');
    expect(runner).toMatch(/prisma migrate deploy && exec node server\.js/);
  });
});
