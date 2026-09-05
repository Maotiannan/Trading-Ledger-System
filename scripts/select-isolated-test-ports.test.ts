import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('isolated test port selector', () => {
  const selectorPath = path.join(
    process.cwd(),
    'scripts',
    'select-isolated-test-ports.mjs',
  );

  it('returns distinct operating-system-assigned ports that Node fetch permits', async () => {
    const output = execFileSync(process.execPath, [selectorPath, '2'], {
      encoding: 'utf8',
    }).trim();
    const ports = output.split(/\s+/).map(Number);

    expect(ports).toHaveLength(2);
    expect(new Set(ports).size).toBe(2);
    for (const port of ports) {
      expect(Number.isInteger(port)).toBe(true);
      expect(port).toBeGreaterThan(1024);
      expect(port).toBeLessThanOrEqual(65535);

      try {
        await fetch(`http://127.0.0.1:${port}`);
      } catch (error) {
        expect((error as { cause?: { message?: string } }).cause?.message).not.toBe(
          'bad port',
        );
      }
    }
  });

  it('is shared by both isolated API and browser harnesses without random port ranges', () => {
    for (const scriptName of ['test-api-isolated.sh', 'test-e2e-isolated.sh']) {
      const script = readFileSync(
        path.join(process.cwd(), 'scripts', scriptName),
        'utf8',
      );
      expect(script).toContain('node scripts/select-isolated-test-ports.mjs');
      expect(script).not.toContain('RANDOM %');
    }
  });
});
