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
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
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

  it.each(['expired', 'root', 'publication', 'manifest', 'EACCES', 'EIO'])('handles a disappearing retention path: %s', (scenario) => {
    const f = fixture();
    try {
      const expired = createSnapshotDirectory(f.backup, '20200101-010000');
      const today = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      const published = realpathSync(createSnapshotDirectory(f.backup, today + '-023000'));
      writeFileSync(path.join(published, 'manifest.json'), '{}');
      const recent = createSnapshotDirectory(f.backup, today + '-010000');
      const root = realpathSync(path.join(f.backup, 'snapshots'));
      const oldDay = realpathSync(path.dirname(expired));
      const injected = path.join(f.root, 'filesystem.cjs');
      writeFileSync(injected, `
        const fs = require('node:fs'), orig = fs.readdirSync;
        fs.readdirSync = function (p, ...args) {
          if (p === process.env.ROOT && process.env.SCENARIO === 'publication') {
            fs.renameSync(process.env.PUBLICATION, process.env.PUBLICATION + '-gone');
          } else if (p === process.env.ROOT && process.env.SCENARIO === 'manifest') {
            fs.unlinkSync(process.env.PUBLICATION + '/manifest.json');
          } else if (p === process.env.FAULT_PATH) {
            if (process.env.SCENARIO === 'root') fs.renameSync(process.env.ROOT, process.env.ROOT + '-gone');
            else if (process.env.SCENARIO === 'expired') fs.renameSync(p, p+'-gone');
            else if (['EACCES','EIO'].includes(process.env.SCENARIO)) throw Object.assign(new Error(process.env.SCENARIO), {code:process.env.SCENARIO, syscall:'scandir', path:p});
          }
          return orig.call(fs,p,...args);
        };
      `);
      const result = spawnSync(process.execPath, ['-r', injected, path.join(path.dirname(script), 'prune-local-snapshots.cjs'), root, published, '30'], {
        encoding: 'utf8', env: { ...process.env, ROOT: root, PUBLICATION: published, SCENARIO: scenario, FAULT_PATH: oldDay },
      });
      expect(result.status).toBe(scenario === 'expired' ? 0 : 1);
      if (scenario === 'expired') {
        expect(existsSync(path.join(published, 'manifest.json'))).toBe(true);
        expect(existsSync(path.join(recent, 'sentinel.txt'))).toBe(true);
      }
    } finally { f.cleanup(); }
  });

  it('skips protected date branches before any SMB type lookup and still processes the local cutoff day', () => {
    const f = fixture();
    try {
      const expired = createSnapshotDirectory(f.backup, '20261026-010000');
      const onCutoff = createSnapshotDirectory(f.backup, '20261027-010000');
      const afterCutoff = createSnapshotDirectory(f.backup, '20261027-030000');
      const nextDay = createSnapshotDirectory(f.backup, '20261028-010000');
      const recent = createSnapshotDirectory(f.backup, '20261102-010000');
      const published = realpathSync(createSnapshotDirectory(f.backup, '20261127-023000'));
      writeFileSync(path.join(published, 'manifest.json'), '{}');
      for (const dir of [expired, onCutoff, nextDay, recent]) utimesSync(dir, 1, 1);
      const late = new Date('2026-10-27T03:00:00+08:00');
      utimesSync(afterCutoff, late, late);
      const root = realpathSync(path.join(f.backup, 'snapshots'));
      const injected = path.join(f.root, 'cifs.cjs');
      writeFileSync(injected, `
        const fs = require('node:fs'), path = require('node:path');
        Date.now = () => Date.parse('2026-11-27T02:30:00+08:00');
        const mixed = path.join(process.env.ROOT, '2026/10'), protectedDay = path.join(mixed, '28');
        const protectedMonth = path.join(process.env.ROOT, '2026/11');
        for (const op of ['readdirSync', 'lstatSync']) {
          const original = fs[op];
          fs[op] = function (dir, ...args) {
            if (op === 'readdirSync' && dir === mixed && args[0]?.withFileTypes)
              throw Object.assign(Error('stale DT_UNKNOWN child'), {code:'ENOENT', path:protectedDay, syscall:'lstat'});
            if (dir === protectedDay || dir === protectedMonth)
              throw Object.assign(Error('probed a protected branch'), {code:'EIO', path:dir});
            return original.call(fs, dir, ...args);
          };
        }
      `);
      const result = spawnSync(process.execPath, ['-r', injected, path.join(path.dirname(script), 'prune-local-snapshots.cjs'), root, published, '30'], {
        encoding: 'utf8', env: { ...process.env, ROOT: root, TZ: 'Asia/Shanghai' },
      });
      expect({ status: result.status, error: result.stderr.includes('ERROR:') }).toEqual({ status: 0, error: false });
      for (const dir of [expired, onCutoff]) expect(existsSync(dir)).toBe(false);
      for (const dir of [afterCutoff, nextDay, recent]) expect(existsSync(path.join(dir, 'sentinel.txt'))).toBe(true);
      expect(existsSync(path.join(published, 'manifest.json'))).toBe(true);
    } finally { f.cleanup(); }
  });

  it('reports loss of the cutoff day, which may still contain retained snapshots', () => {
    const f = fixture();
    try {
      const cutoff = realpathSync(createSnapshotDirectory(f.backup, '20261027-030000'));
      const published = realpathSync(createSnapshotDirectory(f.backup, '20261127-023000'));
      writeFileSync(path.join(published, 'manifest.json'), '{}');
      const injected = path.join(f.root, 'cutoff.cjs');
      writeFileSync(injected, `
        const fs = require('node:fs'), original = fs.readdirSync;
        Date.now = () => Date.parse('2026-11-27T02:30:00+08:00');
        fs.readdirSync = function (dir, ...args) {
          if (dir === process.env.CUTOFF_DAY) fs.renameSync(dir, dir + '-gone');
          return original.call(fs, dir, ...args);
        }
      `);
      const result = spawnSync(process.execPath, ['-r', injected, path.join(path.dirname(script), 'prune-local-snapshots.cjs'),
        realpathSync(path.join(f.backup, 'snapshots')), published, '30'], {
        encoding: 'utf8', env: { ...process.env, CUTOFF_DAY: path.dirname(cutoff), TZ: 'Asia/Shanghai' },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('ENOENT');
      expect(existsSync(path.join(published, 'manifest.json'))).toBe(true);
    } finally { f.cleanup(); }
  });

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

  it('uses an empty directory lock so SMB does not retain a deleted lock file', () => {
    const f = fixture();
    try {
      const inspection = path.join(f.root, 'lock-contents.txt');
      const inspectingDump = path.join(f.bin, 'inspect-lock-mariadb-dump');
      writeFileSync(
        inspectingDump,
        `#!/bin/sh
set -eu
ls -A "$MULEDGER_LOCAL_BACKUP_ROOT/.backup.lock" > "$LOCK_INSPECTION_PATH"
printf '%s\n' 'CREATE TABLE sample(id INT);' 'INSERT INTO sample VALUES (1);'
`,
      );
      chmodSync(inspectingDump, 0o700);

      const result = runBackup(f, [], {
        MYSQLDUMP_BIN: inspectingDump,
        LOCK_INSPECTION_PATH: inspection,
      });

      expect(result.status).toBe(0);
      expect(readFileSync(inspection, 'utf8')).toBe('');
      expect(existsSync(path.join(f.backup, '.backup.lock'))).toBe(false);
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

  it('defers SMB tombstones without deleting them, prunes other expired snapshots and resumes only retired work', () => {
    const f = fixture();
    try {
      const expired = createSnapshotDirectory(f.backup, '20200101-023000');
      const other = createSnapshotDirectory(f.backup, '20200102-023000');
      const legacy = createSnapshotDirectory(f.backup, '20200103-023000');
      renameSync(path.join(legacy, 'sentinel.txt'), path.join(legacy, '.smbdelete-legacy'));
      const media = path.join(expired, 'media');
      mkdirSync(media);
      writeFileSync(path.join(media, '.smbdelete-test'), 'held by SMB');
      execFileSync('touch', ['-t', '202001010000', expired, other]);
      const first = runBackup(f);
      expect(first.stdout).toMatch(/^PUBLISHED_SNAPSHOT=snapshots\//m);
      expect(first.status).toBe(75);
      expect(existsSync(other)).toBe(false);
      expect(existsSync(expired)).toBe(false);
      const retired = path.join(path.dirname(expired), '.retiring-' + path.basename(expired));
      const retiredLegacy = path.join(path.dirname(legacy), '.retiring-' + path.basename(legacy));
      expect(existsSync(legacy)).toBe(false);
      expect(existsSync(path.join(retiredLegacy, '.smbdelete-legacy'))).toBe(true);
      const marker = path.join(retired, 'media', '.smbdelete-test');
      expect(readFileSync(marker, 'utf8')).toBe('held by SMB');
      const published = findOnlySnapshot(f.backup);
      expect(runBackup(f, ['--verify', published]).status).toBe(0);
      // Move only this synthetic snapshot aside to avoid a same-second name collision on rerun.
      renameSync(published, path.join(f.root, 'verified-first-snapshot'));
      rmSync(marker);
      rmSync(path.join(retiredLegacy, '.smbdelete-legacy'));
      const next = runBackup(f);
      expect(next.status).toBe(0);
      expect(existsSync(retired)).toBe(false);
      expect(existsSync(retiredLegacy)).toBe(false);
    } finally { f.cleanup(); }
  });

  it('does not prune a mismatched date path or a symlink to a different backup tree', () => {
    const f = fixture();
    try {
      const good = createSnapshotDirectory(f.backup, '20200101-023000');
      const wrongDay = path.join(path.dirname(good), 'muledger-19990101-023000');
      renameSync(good, wrongDay);
      execFileSync('touch', ['-t', '202001010000', wrongDay]);
      const outside = path.join(f.root, 'elsewhere');
      mkdirSync(outside);
      writeFileSync(path.join(outside, 'keep'), 'untouched');
      symlinkSync(outside, good);
      runBackup(f);
      expect(readFileSync(path.join(wrongDay, 'sentinel.txt'), 'utf8')).toBe('20200101-023000');
      expect(lstatSync(good).isSymbolicLink()).toBe(true);
      expect(readFileSync(path.join(outside, 'keep'), 'utf8')).toBe('untouched');
    } finally { f.cleanup(); }
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
      'scripts/backup/run-muledger-local-backup-docker.sh',
      'scripts/backup/check-muledger-local-backup-status.sh',
      'scripts/backup/muledger-backup.env.example',
      'scripts/backup/install-muledger-backup-launchd.sh',
    ]
      .map((file) => readFileSync(path.join(process.cwd(), file), 'utf8'))
      .join('\n');

    expect(active).not.toMatch(/COS_SECRET|coscli|cos:\/\//i);
    expect(active).toContain('MULEDGER_LOCAL_BACKUP_ROOT');
    expect(active).toContain('muledger-local-backup.sh');
    expect(active).toContain('run-muledger-local-backup-docker.sh');
    expect(active).toContain('com.muledger.local-backup');
  });

  it('keeps the scheduled dump client on the production MariaDB major version', () => {
    const dockerfile = readFileSync(
      path.join(process.cwd(), 'scripts', 'backup', 'Dockerfile'),
      'utf8',
    );

    expect(dockerfile).toContain('FROM mariadb:10.6');
    expect(dockerfile).toContain('COPY --from=node-runtime');
  });
});
