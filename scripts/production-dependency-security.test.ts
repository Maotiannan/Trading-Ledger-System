/** @jest-environment node */
import { execFileSync } from 'node:child_process';

function runNode(source: string) {
  return execFileSync(process.execPath, ['-e', source], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 15000,
  }).trim();
}

describe('Prisma configuration merge security compatibility', () => {
  const setup = `
    const assert = require('node:assert/strict');
    const fromConfig = require('node:module').createRequire(require.resolve('@prisma/config'));
    const { deepmerge } = fromConfig('deepmerge-ts');
  `;

  it('preserves nested plain configuration and array merge semantics', () => {
    expect(runNode(setup + `
      assert.deepEqual(deepmerge(
        { migrations: { path: 'prisma/migrations' }, list: ['a'] },
        { migrations: { seed: 'node seed.js' }, list: ['b'] }
      ), { migrations: { path: 'prisma/migrations', seed: 'node seed.js' }, list: ['a', 'b'] });
      console.log('ok');
    `)).toBe('ok');
  });

  it('handles circular graphs without stack exhaustion', () => {
    expect(runNode(setup + `
      const a = { label: 'a' }; a.self = a;
      const b = { label: 'b' }; b.self = b;
      const result = deepmerge(a, b);
      assert.equal(result.label, 'b');
      assert.equal(result.self, result);
      console.log('ok');
    `)).toBe('ok');
  });

  it('loads a real Prisma configuration from a disposable directory', () => {
    expect(runNode(`
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const path = require('node:path');
      const root = fs.realpathSync(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'muledger-prisma-config-')));
      fs.writeFileSync(path.join(root, 'prisma.config.js'),
        'module.exports = { schema: "schema.prisma", migrations: { path: "migrations" } };');
      require('@prisma/config').loadConfigFromFile({ configRoot: root }).then(result => {
        assert.equal(result.error, undefined);
        assert.equal(result.config.schema, path.join(root, 'schema.prisma'));
        assert.equal(result.config.migrations.path, path.join(root, 'migrations'));
        console.log('ok');
      }).catch(error => { console.error(error); process.exitCode = 1; })
        .finally(() => fs.rmSync(root, { recursive: true, force: true }));
    `)).toBe('ok');
  });
});
