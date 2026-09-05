import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('production Docker image dependency contract', () => {
  const dockerfile = readFileSync(path.join(process.cwd(), 'Dockerfile'), 'utf8');

  it('uses the lockfile for deterministic dependency installation', () => {
    expect(dockerfile).toMatch(/RUN\s+npm ci(?:\s|$)/);
    expect(dockerfile).not.toMatch(/RUN\s+npm install(?:\s|$)/);
  });

  it('prunes development dependencies before copying node_modules into the runner', () => {
    expect(dockerfile).toMatch(/FROM\s+builder\s+AS\s+prod-deps/);
    expect(dockerfile).toMatch(/RUN\s+npm prune --omit=dev(?:\s|$)/);
    expect(dockerfile).toContain(
      'COPY --from=prod-deps /app/node_modules ./node_modules',
    );
    expect(dockerfile).not.toContain(
      'COPY --from=builder /app/node_modules ./node_modules',
    );
  });
});
