/** @jest-environment node */

import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const runner = path.join(
  process.cwd(),
  'scripts',
  'backup',
  'run-muledger-local-backup-docker.sh',
);
const statusChecker = path.join(
  process.cwd(),
  'scripts',
  'backup',
  'check-muledger-local-backup-status.sh',
);

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'muledger-backup-runner-'));
  const envFile = path.join(root, 'backup.env');
  const statusFile = path.join(root, 'status.json');
  const dockerLog = path.join(root, 'docker.log');
  const dockerCount = path.join(root, 'docker.count');
  const fakeDocker = path.join(root, 'docker');
  const upload = path.join(root, 'upload');
  const backup = path.join(root, 'backup');

  writeFileSync(
    envFile,
    [
      'DATABASE_URL=mysql://backup-user:secret@192.168.1.3:3306/trading_ledger',
      `UPLOAD_HOST_DIR=${upload}`,
      `MULEDGER_LOCAL_BACKUP_ROOT=${backup}`,
      'LOCAL_RETENTION_DAYS=30',
      'MULEDGER_BACKUP_MIN_FREE_BYTES=0',
    ].join('\n') + '\n',
  );
  chmodSync(envFile, 0o600);

  writeFileSync(
    fakeDocker,
    `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
case "\${1:-}" in
  info) exit 0 ;;
  image) exit 0 ;;
  run)
    count=0
    if [ -f "$FAKE_DOCKER_COUNT" ]; then count="$(cat "$FAKE_DOCKER_COUNT")"; fi
    count=$((count + 1))
    printf '%s' "$count" > "$FAKE_DOCKER_COUNT"
    if [ "$count" -lt "$FAKE_DOCKER_SUCCEED_ON" ]; then exit 42; fi
    exit 0
    ;;
esac
exit 64
`,
  );
  chmodSync(fakeDocker, 0o700);

  return {
    root,
    envFile,
    statusFile,
    dockerLog,
    dockerCount,
    fakeDocker,
    upload,
    backup,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function runRunner(
  f: ReturnType<typeof fixture>,
  overrides: Record<string, string> = {},
) {
  return spawnSync('bash', [runner, '--env', f.envFile], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      DOCKER_BIN: f.fakeDocker,
      FAKE_DOCKER_LOG: f.dockerLog,
      FAKE_DOCKER_COUNT: f.dockerCount,
      FAKE_DOCKER_SUCCEED_ON: '3',
      MULEDGER_BACKUP_DOCKER_IMAGE: 'muledger-local-backup:test',
      MULEDGER_BACKUP_STATUS_FILE: f.statusFile,
      MULEDGER_BACKUP_MAX_ATTEMPTS: '3',
      MULEDGER_BACKUP_RETRY_SECONDS: '0',
      ...overrides,
    },
  });
}

describe('MULEDGER Docker backup runner', () => {
  it('retries inside Docker and records a successful scheduled backup', () => {
    const f = fixture();
    try {
      const result = runRunner(f);

      expect(result.status).toBe(0);
      if (!existsSync(f.dockerCount)) {
        throw new Error(`Docker run was not called. stderr:\n${result.stderr}\nlog:\n${readFileSync(f.dockerLog, 'utf8')}`);
      }
      expect(readFileSync(f.dockerCount, 'utf8')).toBe('3');
      const calls = readFileSync(f.dockerLog, 'utf8');
      expect(calls).toContain('info');
      expect(calls).toContain('image inspect muledger-local-backup:test');
      expect(calls).toContain(`source=${f.upload},target=/data/upload,readonly`);
      expect(calls).toContain(`source=${f.backup},target=/data/backup`);
      expect(calls).not.toContain('secret');

      const status = JSON.parse(readFileSync(f.statusFile, 'utf8'));
      expect(status).toMatchObject({
        schemaVersion: 1,
        status: 'SUCCESS',
        attempts: 3,
        exitCode: 0,
        mode: 'BACKUP',
        maxAgeSeconds: 129600,
      });
      expect(status.lastSuccessfulAt).toBe(status.completedAt);
    } finally {
      f.cleanup();
    }
  });

  it('records a failed scheduled backup after the configured attempts', () => {
    const f = fixture();
    try {
      const result = runRunner(f, {
        FAKE_DOCKER_SUCCEED_ON: '99',
        MULEDGER_BACKUP_MAX_ATTEMPTS: '2',
      });

      expect(result.status).toBe(42);
      expect(readFileSync(f.dockerCount, 'utf8')).toBe('2');
      const status = JSON.parse(readFileSync(f.statusFile, 'utf8'));
      expect(status).toMatchObject({
        schemaVersion: 1,
        status: 'FAILED',
        attempts: 2,
        exitCode: 42,
        mode: 'BACKUP',
        lastSuccessfulAt: null,
      });
    } finally {
      f.cleanup();
    }
  });
});

describe('MULEDGER backup status checker', () => {
  it('accepts a fresh successful backup and rejects a stale one', () => {
    const f = fixture();
    try {
      const now = new Date().toISOString();
      writeFileSync(
        f.statusFile,
        JSON.stringify({
          schemaVersion: 1,
          status: 'SUCCESS',
          startedAt: now,
          completedAt: now,
          lastSuccessfulAt: now,
          attempts: 1,
          exitCode: 0,
          mode: 'BACKUP',
        }),
      );

      const fresh = spawnSync('bash', [statusChecker, '--status', f.statusFile], {
        encoding: 'utf8',
        env: { ...process.env, MULEDGER_BACKUP_MAX_AGE_SECONDS: '129600' },
      });
      expect(fresh.status).toBe(0);
      expect(fresh.stdout).toContain('RESULT=HEALTHY');

      const staleStatus = JSON.parse(readFileSync(f.statusFile, 'utf8'));
      staleStatus.lastSuccessfulAt = '2020-01-01T00:00:00.000Z';
      writeFileSync(f.statusFile, JSON.stringify(staleStatus));

      const stale = spawnSync('bash', [statusChecker, '--status', f.statusFile], {
        encoding: 'utf8',
        env: { ...process.env, MULEDGER_BACKUP_MAX_AGE_SECONDS: '129600' },
      });
      expect(stale.status).not.toBe(0);
      expect(stale.stdout).toContain('RESULT=STALE');
    } finally {
      f.cleanup();
    }
  });
});
