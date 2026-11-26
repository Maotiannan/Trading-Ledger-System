/** @jest-environment node */
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

describe('local rebuild script safety contract', () => {
  const scriptPath = path.join(process.cwd(), 'scripts', 'rebuild-local-app.sh');

  it.each([
    ['1.0.233', '1.0.241', false, 1],
    ['1.0.241', '1.0.241', true, 1],
    ['1.0.100', '1.0.99', false, 0],
    ['1.0.241', 'unknown', false, 1],
    ['1.0.241', '', false, 1],
  ] as const)('checks %s against live %s (release overrides: %s) before any write', (version, live, overrides, code) => {
    const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'muledger-rebuild-guard-')));
    try {
      const script = path.join(root, 'scripts/rebuild-local-app.sh');
      mkdirSync(path.dirname(script));
      copyFileSync(scriptPath, script);
      writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }));
      const fake = path.join(root, 'docker');
      writeFileSync(fake, `#!/bin/sh
set -eu
echo "$*" >> "$TEST_ROOT/docker.log"
case "$1" in
  ps) echo isolated-app-id ;;
  exec) [ "$2" = isolated-app-id ] && [ -n "$TEST_LIVE" ] || exit 1; echo "$TEST_LIVE" ;;
  inspect) case "$*" in *working_dir*) echo "$TEST_ROOT";; *config_files*) echo "$TEST_FILES";; *) exit 1;; esac ;;
  compose) [ "$2" = config ] || exit 91; printf '{"name":"trading-ledger-system","services":{"app":{"build":{"context":"%s"}}}}' "$TEST_ROOT" ;;
  *) exit 92 ;;
esac
`);
      chmodSync(fake, 0o700);
      const args = code === 0 ? [script, '--check-only'] : [script];
      const result = spawnSync('bash', args, { cwd: root, encoding: 'utf8', env: {
        ...process.env, PATH: root + ':' + process.env.PATH, TEST_ROOT: root, TEST_LIVE: live,
        TEST_FILES: path.join(root, 'docker-compose.yml') + (overrides ? ',/release/deploy.override.json' : ''),
      } });
      expect(result.status).toBe(code);
      expect(existsSync(path.join(root, '.env'))).toBe(false);
      expect(readFileSync(path.join(root, 'docker.log'), 'utf8')).not.toMatch(/compose (up|exec|ps)|--build|force-recreate/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('rebuilds only the app service and refreshes internal trigger services without destructive commands', () => {
    const script = readFileSync(scriptPath, 'utf8');

    expect(script).toContain('docker compose up -d --no-deps --build app');
    expect(script).toContain('docker compose up -d --no-deps --force-recreate maintenance');
    expect(script).toContain('docker compose up -d --no-deps --force-recreate mucontract-sync-trigger');
    expect(script).toContain('docker compose up -d --no-deps --force-recreate email-delivery-trigger');
    expect(script).toContain('MAINTENANCE_JOB_TOKEN');
    expect(script).toContain('SESSION_SECRET');
    expect(script).toContain('/api/system/health');
    expect(script).toContain('/api/internal/integrations/mu-contract/pull');
    expect(script).not.toMatch(/docker\s+compose\s+down\s+-v/);
    expect(script).not.toMatch(/docker\s+volume\s+rm/);
    expect(script).not.toMatch(/prisma\s+db\s+push/);
    expect(script).not.toMatch(/rm\s+-rf\s+\$?\{?UPLOAD/i);
  });
});
