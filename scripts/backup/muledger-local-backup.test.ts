/** @jest-environment node */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const script = path.join(process.cwd(), 'scripts', 'backup', 'muledger-local-backup.sh');

type Fixture = ReturnType<typeof fixture>;

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'muledger-local-backup-'));
  const source = path.join(root, 'upload');
  const backup = path.join(root, 'backup');
  const bin = path.join(root, 'bin');
  mkdirSync(path.join(source, 'images', 'receipts'), { recursive: true });
  mkdirSync(backup, { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(source, 'images', 'receipts', 'receipt.jpg'), 'receipt-data');
  writeFileSync(path.join(source, 'readme.txt'), 'media-root');

  const dump = path.join(bin, 'fake-mariadb-dump');
  writeFileSync(
    dump,
    '#!/bin/sh\nprintf "%s\\n" "CREATE TABLE sample(id INT);" "INSERT INTO sample VALUES (1);"\n',
  );
  chmodSync(dump, 0o700);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL:
      'mysql://backup-user:secret-not-for-output@127.0.0.1:3306/trading_ledger',
    UPLOAD_HOST_DIR: source,
    MULEDGER_LOCAL_BACKUP_ROOT: backup,
    LOCAL_RETENTION_DAYS: '30',
    MULEDGER_BACKUP_MIN_FREE_BYTES: '0',
    MYSQLDUMP_BIN: dump,
  };

  return {
    root,
    source,
    backup,
    bin,
    dump,
    env,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function runBackup(
  f: Fixture,
  args: string[] = [],
  overrides: Partial<NodeJS.ProcessEnv> = {},
) {
  return spawnSync('bash', [script, ...args], {
    cwd: process.cwd(),
    env: { ...f.env, ...overrides },
    encoding: 'utf8',
  });
}

function walkDirectories(root: string): string[] {
  if (!existsSync(root)) return [];
  const directories: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (!entry.isDirectory()) continue;
    directories.push(fullPath, ...walkDirectories(fullPath));
  }
  return directories;
}

function findSnapshots(backup: string): string[] {
  return walkDirectories(path.join(backup, 'snapshots'))
    .filter((directory) => path.basename(directory).startsWith('muledger-'))
    .sort();
}

function findOnlySnapshot(backup: string): string {
  const matches = findSnapshots(backup);
  if (matches.length !== 1) {
    throw new Error(`Expected one snapshot, found ${matches.length}: ${matches.join(', ')}`);
  }
  return matches[0];
}

function findOnlyFile(root: string, suffix: string): string {
  const matches = readdirSync(root)
    .filter((name) => name.endsWith(suffix))
    .map((name) => path.join(root, name));
  if (matches.length !== 1) {
    throw new Error(`Expected one ${suffix} file, found ${matches.length}`);
  }
  return matches[0];
}

function createSnapshotDirectory(backup: string, stamp: string): string {
  const day = `${stamp.slice(0, 4)}/${stamp.slice(4, 6)}/${stamp.slice(6, 8)}`;
  const directory = path.join(backup, 'snapshots', day, `muledger-${stamp}`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'sentinel.txt'), stamp);
  return directory;
}

describe('MULEDGER NAS local backup', () => {
  jest.setTimeout(30_000);

  it('prints a local plan without creating files during dry run', () => {
    const f = fixture();
    try {
      const result = runBackup(f, ['--dry-run']);

      expect(result.status).toBe(0);
      expect(result.stderr).toContain('Dry run only');
      expect(result.stderr).toContain(f.backup);
      expect(result.stderr).not.toContain('COS');
      expect(readdirSync(f.backup)).toHaveLength(0);
    } finally {
      f.cleanup();
    }
  });

  it('publishes and verifies one complete database and media snapshot', () => {
    const f = fixture();
    try {
      const result = runBackup(f);
      expect(result.status).toBe(0);

      const snapshot = findOnlySnapshot(f.backup);
      const databaseDirectory = path.join(snapshot, 'database');
      const mediaDirectory = path.join(snapshot, 'media');
      const database = findOnlyFile(databaseDirectory, '.sql.gz');
      const media = findOnlyFile(mediaDirectory, '.tar.gz');
      const manifest = JSON.parse(readFileSync(path.join(snapshot, 'manifest.json'), 'utf8'));

      expect(existsSync(`${database}.sha256`)).toBe(true);
      expect(existsSync(`${media}.sha256`)).toBe(true);
      expect(existsSync(path.join(snapshot, 'manifest.json.sha256'))).toBe(true);
      expect(manifest).toMatchObject({
        project: 'muledger',
        formatVersion: 1,
        databaseName: 'trading_ledger',
        mediaFileCount: 2,
      });
      expect(JSON.stringify(manifest)).not.toContain('secret-not-for-output');

      const verify = runBackup(f, ['--verify', snapshot]);
      expect(verify.status).toBe(0);
      expect(verify.stderr).toContain('Snapshot verification passed');
      expect(execFileSync('gzip', ['-dc', database], { encoding: 'utf8' })).toContain(
        'INSERT INTO sample VALUES (1)',
      );
      expect(execFileSync('tar', ['-tzf', media], { encoding: 'utf8' })).toContain(
        './images/receipts/receipt.jpg',
      );
    } finally {
      f.cleanup();
    }
  });

  it.each([
    ['database dump', 'database', '.sql.gz'],
    ['media archive', 'media', '.tar.gz'],
  ])('rejects a snapshot with a modified %s', (_label, directory, suffix) => {
    const f = fixture();
    try {
      expect(runBackup(f).status).toBe(0);
      const snapshot = findOnlySnapshot(f.backup);
      const file = findOnlyFile(path.join(snapshot, directory), suffix);
      writeFileSync(file, 'tampered');

      const verify = runBackup(f, ['--verify', snapshot]);

      expect(verify.status).not.toBe(0);
      expect(`${verify.stdout}\n${verify.stderr}`.toLowerCase()).toContain('checksum');
    } finally {
      f.cleanup();
    }
  });

  it('rejects backup roots that overlap the upload source', () => {
    const f = fixture();
    try {
      const same = runBackup(f, [], { MULEDGER_LOCAL_BACKUP_ROOT: f.source });
      const child = path.join(f.source, 'backup-child');
      mkdirSync(child);
      const nested = runBackup(f, [], { MULEDGER_LOCAL_BACKUP_ROOT: child });

      expect(same.status).not.toBe(0);
      expect(nested.status).not.toBe(0);
      expect(`${same.stderr}\n${nested.stderr}`.toLowerCase()).toContain('overlap');
    } finally {
      f.cleanup();
    }
  });

  it('rejects symbolic links in the media source', () => {
    const f = fixture();
    try {
      symlinkSync(path.join(f.source, 'readme.txt'), path.join(f.source, 'linked.txt'));
      const result = runBackup(f);

      expect(result.status).not.toBe(0);
      expect(result.stderr.toLowerCase()).toContain('symbolic link');
    } finally {
      f.cleanup();
    }
  });

  it('rejects a concurrent run without disturbing its lock', () => {
    const f = fixture();
    try {
      const lock = path.join(f.backup, '.backup.lock');
      mkdirSync(lock);
      writeFileSync(path.join(lock, 'owner.json'), '{"pid":123}\n');

      const result = runBackup(f);

      expect(result.status).not.toBe(0);
      expect(result.stderr.toLowerCase()).toContain('already running');
      expect(readFileSync(path.join(lock, 'owner.json'), 'utf8')).toContain('123');
    } finally {
      f.cleanup();
    }
  });

  it('preserves existing snapshots and skips retention when the dump fails', () => {
    const f = fixture();
    try {
      const existing = createSnapshotDirectory(f.backup, '20200101-023000');
      execFileSync('touch', ['-t', '202001010000', existing]);
      const failedDump = path.join(f.bin, 'failed-mariadb-dump');
      writeFileSync(failedDump, '#!/bin/sh\nexit 42\n');
      chmodSync(failedDump, 0o700);

      const result = runBackup(f, [], { MYSQLDUMP_BIN: failedDump });

      expect(result.status).not.toBe(0);
      expect(result.stderr.toLowerCase()).toContain('database dump failed');
      expect(findSnapshots(f.backup).map((item) => path.basename(item))).toEqual([
        'muledger-20200101-023000',
      ]);
      expect(readFileSync(path.join(existing, 'sentinel.txt'), 'utf8')).toBe(
        '20200101-023000',
      );
    } finally {
      f.cleanup();
    }
  });

  it('removes only expired, correctly named snapshots after a successful backup', () => {
    const f = fixture();
    try {
      const expired = createSnapshotDirectory(f.backup, '20200101-023000');
      const recent = createSnapshotDirectory(f.backup, '20260718-023000');
      const unexpected = path.join(f.backup, 'snapshots', 'keep-me');
      mkdirSync(unexpected, { recursive: true });
      writeFileSync(path.join(unexpected, 'sentinel.txt'), 'keep');
      execFileSync('touch', ['-t', '202001010000', expired]);

      const result = runBackup(f);

      expect(result.status).toBe(0);
      const names = findSnapshots(f.backup).map((item) => path.basename(item));
      expect(names).not.toContain('muledger-20200101-023000');
      expect(names).toContain(path.basename(recent));
      expect(names.filter((name) => name !== path.basename(recent))).toHaveLength(1);
      expect(lstatSync(unexpected).isDirectory()).toBe(true);
      expect(readFileSync(path.join(unexpected, 'sentinel.txt'), 'utf8')).toBe('keep');
    } finally {
      f.cleanup();
    }
  });

  it('rejects verification paths outside the configured backup root', () => {
    const f = fixture();
    try {
      const outside = path.join(f.root, 'outside-snapshot');
      mkdirSync(outside);

      const result = runBackup(f, ['--verify', outside]);

      expect(result.status).not.toBe(0);
      expect(result.stderr.toLowerCase()).toContain('outside backup root');
    } finally {
      f.cleanup();
    }
  });

  it('rejects an explicitly configured environment file that is not mode 600', () => {
    const f = fixture();
    try {
      const envFile = path.join(f.root, 'insecure-backup.env');
      writeFileSync(envFile, '# inherited test environment\n');
      chmodSync(envFile, 0o644);

      const result = runBackup(f, ['--env', envFile, '--dry-run']);

      expect(result.status).not.toBe(0);
      expect(result.stderr.toLowerCase()).toContain('mode 600');
    } finally {
      f.cleanup();
    }
  });

  it('refuses to back up any database other than trading_ledger', () => {
    const f = fixture();
    try {
      const result = runBackup(f, [], {
        DATABASE_URL: 'mysql://backup-user:secret@127.0.0.1:3306/not_the_business_database',
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('trading_ledger');
      expect(findSnapshots(f.backup)).toHaveLength(0);
    } finally {
      f.cleanup();
    }
  });

  it('keeps the active backup command, environment example, and launch agent local-only', () => {
    const active = [
      'scripts/backup/muledger-local-backup.sh',
      'scripts/backup/muledger-backup.env.example',
      'scripts/backup/install-muledger-backup-launchd.sh',
    ]
      .map((file) => readFileSync(path.join(process.cwd(), file), 'utf8'))
      .join('\n');

    expect(active).not.toMatch(/COS_SECRET|coscli|cos:\/\//i);
    expect(active).toContain('MULEDGER_LOCAL_BACKUP_ROOT');
    expect(active).toContain('muledger-local-backup.sh');
    expect(active).toContain('com.muledger.local-backup');
  });
});
