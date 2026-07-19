# MULEDGER NAS Local Backup Implementation Plan

> **Status:** ACTIVE on `ops/muledger-nas-local-backup`; implementation is complete, while CI, real NAS snapshot verification, isolated restore, and controlled MULEDGER deployment remain gated.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace MULEDGER's Tencent COS backup integration with verified daily database and media snapshots stored on the NAS, then use a fresh snapshot to finish the already approved MU Contract Orders synchronization deployment.

**Architecture:** A single Bash entry point owns backup, verification, locking, atomic publication, and retention. It writes complete timestamped snapshots beneath a fixed NAS root, never restores production data, and exposes a read-only verification mode. Jest drives the shell script through temporary directories and a fake dump command; deployment uses a real snapshot plus the existing isolated MariaDB/API gates before touching the active application.

**Tech Stack:** Bash 3.2-compatible shell, MariaDB 10.6 dump client, gzip, tar, SHA-256, Node.js/Jest, macOS LaunchAgent, Docker Compose, Prisma migrations.

---

## File Structure

- Create `scripts/backup/muledger-local-backup.sh`: backup, verify, lock, atomic publish, and retention entry point.
- Create `scripts/backup/muledger-local-backup.test.ts`: executable behavior and safety tests using temporary files.
- Modify `scripts/backup/install-muledger-backup-launchd.sh`: install the local-only daily job and retire the old COS job.
- Modify `scripts/backup/muledger-backup.env.example`: keep only database, NAS source, destination, retention, and dump-client settings.
- Delete `scripts/backup/muledger-cos-backup.sh`: remove COS upload behavior.
- Delete `scripts/backup/install-coscli-macos.sh`: remove project-owned COSCLI installation behavior.
- Rename `docs/backup/muledger-cos-backup.md` to `docs/backup/muledger-local-backup.md`: publish the active backup and restore runbook while preserving historical COS drill documents.
- Modify `README.md`, `CHANGE_CHECKLIST.md`, `docs/data-and-integrations.md`, `ENGINEERING_LOG.md`, `todolist.md`, and `docs/superpowers/plans/README.md`: point maintainers to the local backup gate and update plan status.
- Modify `package.json` and `package-lock.json`: bump the single runtime version from `1.0.209` to `1.0.210`.
- Create `docs/backup/restore-drills/2026-07-19-muledger-nas-local-backup-rollout.md`: record the actual snapshot, isolated restore, migration, deployment, and rollback evidence.

### Task 1: Define Local Snapshot Behavior With Failing Tests

**Files:**
- Create: `scripts/backup/muledger-local-backup.test.ts`
- Expected missing implementation: `scripts/backup/muledger-local-backup.sh`

- [x] **Step 1: Add a test harness that creates isolated source, backup, and fake dump directories**

Use real `tar`, `gzip`, and `shasum`, but provide a fake `mariadb-dump` that writes deterministic SQL. The harness must never read `.env` or the active NAS:

```ts
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const script = path.join(process.cwd(), 'scripts/backup/muledger-local-backup.sh');

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'muledger-local-backup-'));
  const source = path.join(root, 'upload');
  const backup = path.join(root, 'backup');
  const bin = path.join(root, 'bin');
  mkdirSync(path.join(source, 'images', 'receipts'), { recursive: true });
  mkdirSync(backup, { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(source, 'images', 'receipts', 'receipt.jpg'), 'receipt-data');
  const dump = path.join(bin, 'fake-mariadb-dump');
  writeFileSync(dump, '#!/bin/sh\nprintf "%s\\n" "CREATE TABLE sample(id INT);"\n');
  chmodSync(dump, 0o700);
  const env = {
    ...process.env,
    DATABASE_URL: 'mysql://backup-user:secret-not-for-output@127.0.0.1:3306/trading_ledger',
    UPLOAD_HOST_DIR: source,
    MULEDGER_LOCAL_BACKUP_ROOT: backup,
    LOCAL_RETENTION_DAYS: '30',
    MULEDGER_BACKUP_MIN_FREE_BYTES: '0',
    MYSQLDUMP_BIN: dump,
  };
  return { root, source, backup, env, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
```

- [x] **Step 2: Add failing tests for dry run, successful publication, and tamper detection**

```ts
it('prints a local plan without creating a snapshot during dry run', () => {
  const f = fixture();
  try {
    const result = spawnSync('bash', [script, '--dry-run'], { env: f.env, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('Dry run only');
    expect(result.stderr).not.toContain('COS');
    expect(readdirSync(f.backup)).toHaveLength(0);
  } finally { f.cleanup(); }
});

it('publishes a verified database, media archive, and manifest', () => {
  const f = fixture();
  try {
    execFileSync('bash', [script], { env: f.env });
    const dayRoots = readdirSync(path.join(f.backup, 'snapshots'));
    expect(dayRoots).toHaveLength(1);
    const snapshot = findOnlySnapshot(path.join(f.backup, 'snapshots'));
    expect(readFileSync(path.join(snapshot, 'manifest.json'), 'utf8')).not.toContain('secret-not-for-output');
    execFileSync('bash', [script, '--verify', snapshot], { env: f.env });
  } finally { f.cleanup(); }
});

it('rejects a snapshot after its database dump is modified', () => {
  const f = fixture();
  try {
    execFileSync('bash', [script], { env: f.env });
    const snapshot = findOnlySnapshot(path.join(f.backup, 'snapshots'));
    const dump = findFile(path.join(snapshot, 'database'), '.sql.gz');
    writeFileSync(dump, 'tampered');
    const result = spawnSync('bash', [script, '--verify', snapshot], { env: f.env, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('checksum');
  } finally { f.cleanup(); }
});
```

Implement `findOnlySnapshot` and `findFile` in the test as deterministic recursive directory helpers; they must throw when zero or multiple matches exist.

- [x] **Step 3: Add failing safety tests for overlap, lock contention, failure preservation, and retention boundaries**

The tests must assert:

```ts
expect(runWith({ MULEDGER_LOCAL_BACKUP_ROOT: source })).toMatchObject({ status: expect.not.stringMatching(/^0$/) });
expect(runWithExistingLock()).toContain('already running');
expect(snapshotNamesAfterForcedDumpFailure()).toEqual(['muledger-20260701-023000']);
expect(snapshotNamesAfterRetention()).toEqual(['muledger-20260718-023000', expect.stringMatching(/^muledger-/)]);
expect(unexpectedSiblingDirectoryStillExists()).toBe(true);
```

Use `touch -t` through `execFileSync` to age only the explicit expired fixture. A fake dump executable that exits `42` must prove a failed run leaves prior snapshots untouched and performs no retention.

- [x] **Step 4: Run the tests and verify RED**

Run:

```bash
npm test -- scripts/backup/muledger-local-backup.test.ts --runInBand
```

Expected: FAIL because `scripts/backup/muledger-local-backup.sh` does not exist and the active installer/env still reference COS.

### Task 2: Implement Atomic NAS Backup And Verification

**Files:**
- Create: `scripts/backup/muledger-local-backup.sh`
- Test: `scripts/backup/muledger-local-backup.test.ts`

- [x] **Step 1: Add Bash 3.2-compatible argument parsing and configuration**

Support only these interfaces:

```text
muledger-local-backup.sh [--env ENV_PATH] [--dry-run]
muledger-local-backup.sh [--env ENV_PATH] --verify SNAPSHOT_DIRECTORY
```

Set these defaults:

```bash
DEFAULT_ENV_FILE="$HOME/.muledger-backup/muledger-backup.env"
MULEDGER_LOCAL_BACKUP_ROOT="${MULEDGER_LOCAL_BACKUP_ROOT:-/Volumes/团队文件-DAINTY_SHIPMENT/docker/backups/muledger}"
UPLOAD_HOST_DIR="${UPLOAD_HOST_DIR:-/Volumes/团队文件-DAINTY_SHIPMENT/docker/trading-ledger-system/upload}"
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-30}"
MULEDGER_BACKUP_MIN_FREE_BYTES="${MULEDGER_BACKUP_MIN_FREE_BYTES:-5368709120}"
MYSQLDUMP_BIN="${MYSQLDUMP_BIN:-auto}"
MYSQLDUMP_DOCKER_IMAGE="${MYSQLDUMP_DOCKER_IMAGE:-mariadb:10.6}"
```

Use `umask 077`, `set -euo pipefail`, an explicit safe `PATH`, and stderr-only timestamped logs. Reject unknown arguments, an empty `DATABASE_URL`, non-numeric retention/free-space settings, and missing source directories.

- [x] **Step 2: Implement path and source-tree validation**

Resolve only existing directories using `cd "$path" && pwd -P`. Reject:

- backup root `/` or empty;
- backup root equal to the upload source;
- either resolved path nested beneath the other;
- symbolic links or special files anywhere in the media source;
- available space below `MULEDGER_BACKUP_MIN_FREE_BYTES`.

Emit human-readable errors containing `overlap`, `symbolic link`, `unsafe file type`, or `insufficient free space` so tests assert the actual failure reason.

- [x] **Step 3: Implement exclusive locking and staging cleanup**

Acquire the lock only with atomic directory creation:

```bash
LOCK_DIR="$MULEDGER_LOCAL_BACKUP_ROOT/.backup.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another MULEDGER local backup is already running: $LOCK_DIR" >&2
  exit 1
fi
LOCK_ACQUIRED=1
printf '{"pid":%s,"startedAt":"%s"}\n' "$$" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$LOCK_DIR/owner.json"
```

The EXIT trap may remove only the current run's staging directory and the lock it acquired. It must not remove a published snapshot or another process's lock.

- [x] **Step 4: Reuse the proven transaction-consistent database dump behavior**

Parse `DATABASE_URL` with Node into a mode-600 staging file, source it, then delete it before publication. Dump with:

```bash
--single-transaction
--routines
--triggers
--events
--default-character-set=utf8mb4
```

Prefer the configured client, then local `mysqldump`, then local `mariadb-dump`, and finally the configured MariaDB Docker image as a client-only container. Pipe directly through `gzip -9` and run `gzip -t` before proceeding.

- [x] **Step 5: Archive media and build checksums/manifest**

Create `media/upload-${timestamp}.tar.gz` with:

```bash
tar -C "$UPLOAD_HOST_DIR" -czf "$media_archive" .
```

Count regular files before archiving. Create SHA-256 files using `shasum -a 256` with a `sha256sum` fallback. Generate `manifest.json` with Node and fields defined in the approved design; serialize no URL, username, password, token, or parsed database environment.

- [x] **Step 6: Implement read-only snapshot verification**

Verification must:

- constrain the resolved snapshot path beneath `$MULEDGER_LOCAL_BACKUP_ROOT/snapshots/`;
- require regular database dump, database checksum, media archive, media checksum, manifest, and manifest checksum files;
- run both checksum checks, `gzip -t` on the dump, and `tar -tzf` on media;
- reject archive members beginning `/`, containing a `../` component, or representing anything except regular files/directories;
- use Node to compare manifest file names, byte sizes, hashes, and media file count against actual files.

Print `Snapshot verification passed: $snapshot_path` only after every check succeeds.

- [x] **Step 7: Atomically publish and perform constrained retention**

Verify staging first, then create the date parent and use `mv` within the same NAS filesystem. Retention may inspect only depth-four directories matching:

```text
snapshots/[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9]/muledger-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]
```

For each expired candidate, resolve and recheck the prefix and name before `find "$candidate" -depth -delete`. Do not run retention during dry-run, verification-only, or any failed backup.

- [x] **Step 8: Run targeted tests and verify GREEN**

Run:

```bash
npm test -- scripts/backup/muledger-local-backup.test.ts --runInBand
bash -n scripts/backup/muledger-local-backup.sh
```

Expected: all local backup tests PASS and Bash syntax returns exit code 0.

- [x] **Step 9: Commit the backup engine**

```bash
git add scripts/backup/muledger-local-backup.sh scripts/backup/muledger-local-backup.test.ts
git commit -m "feat(backup): add atomic NAS snapshots"
```

### Task 3: Remove COS Runtime Configuration And Migrate The Scheduler

**Files:**
- Modify: `scripts/backup/install-muledger-backup-launchd.sh`
- Modify: `scripts/backup/muledger-backup.env.example`
- Delete: `scripts/backup/muledger-cos-backup.sh`
- Delete: `scripts/backup/install-coscli-macos.sh`
- Test: `scripts/backup/muledger-local-backup.test.ts`

- [x] **Step 1: Add a static local-only test and verify RED**

```ts
it('keeps the active backup command, env example, and launch agent local-only', () => {
  const active = [
    'scripts/backup/muledger-local-backup.sh',
    'scripts/backup/muledger-backup.env.example',
    'scripts/backup/install-muledger-backup-launchd.sh',
  ].map((file) => readFileSync(path.join(process.cwd(), file), 'utf8')).join('\n');
  expect(active).not.toMatch(/COS_SECRET|coscli|cos:\/\//i);
  expect(active).toContain('MULEDGER_LOCAL_BACKUP_ROOT');
  expect(active).toContain('muledger-local-backup.sh');
});
```

Run:

```bash
npm test -- scripts/backup/muledger-local-backup.test.ts --runInBand
```

Expected: FAIL because the installer and environment example still contain COS names.

- [x] **Step 2: Replace the environment example**

The example must contain exactly the active settings and explanatory comments:

```bash
DATABASE_URL=mysql://muledger:replace-with-your-password@192.168.1.3:3306/trading_ledger
UPLOAD_HOST_DIR=/Volumes/团队文件-DAINTY_SHIPMENT/docker/trading-ledger-system/upload
MULEDGER_LOCAL_BACKUP_ROOT=/Volumes/团队文件-DAINTY_SHIPMENT/docker/backups/muledger
LOCAL_RETENTION_DAYS=30
MULEDGER_BACKUP_MIN_FREE_BYTES=5368709120
MYSQLDUMP_BIN=auto
MYSQLDUMP_DOCKER_IMAGE=mariadb:10.6
```

It must instruct operators to keep the file mode `600` and must contain no Tencent or COS fields.

- [x] **Step 3: Update the LaunchAgent installer**

Use label `com.muledger.local-backup`, point to `muledger-local-backup.sh`, retain the `02:30` default, and print a local manual command. Before loading the new plist, unload and remove only:

```text
~/Library/LaunchAgents/com.muledger.cos-backup.plist
```

Do not delete old logs, backup snapshots, the machine-wide `coscli` binary, or any remote object.

- [x] **Step 4: Delete project-owned COS scripts and verify GREEN**

Delete the two COS scripts, then run:

```bash
npm test -- scripts/backup/muledger-local-backup.test.ts --runInBand
bash -n scripts/backup/install-muledger-backup-launchd.sh
rg -n 'COS_SECRET|coscli|cos://' scripts/backup
```

Expected: tests PASS, Bash syntax returns 0, and the final `rg` returns no active script/config references. Historical restore-drill files are intentionally excluded.

- [x] **Step 5: Commit scheduler and configuration migration**

```bash
git add scripts/backup
git commit -m "refactor(backup): remove MULEDGER COS integration"
```

### Task 4: Publish Local Backup Documentation And Version

**Files:**
- Rename: `docs/backup/muledger-cos-backup.md` -> `docs/backup/muledger-local-backup.md`
- Modify: `README.md`
- Modify: `CHANGE_CHECKLIST.md`
- Modify: `docs/data-and-integrations.md`
- Modify: `ENGINEERING_LOG.md`
- Modify: `todolist.md`
- Modify: `docs/superpowers/plans/README.md`
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] **Step 1: Rename and rewrite the active runbook**

Keep the authoritative MySQL/NAS data-scope tables and MU Contract migration gate. Replace cloud setup with:

- exact NAS backup root and snapshot layout;
- install, dry-run, backup, verify, logs, retention, and failure commands;
- accepted same-NAS failure limitation;
- isolated restore steps;
- statement that old COS objects are historical and no longer written;
- rule that new database tables remain covered by full `trading_ledger` dumps and new files must remain under `UPLOAD_HOST_DIR`.

Preserve links to the 2026-07-17 and 2026-07-18 historical restore evidence without rewriting those records as local backups.

- [x] **Step 2: Replace active references across engineering documentation**

Change active commands from:

```text
scripts/backup/muledger-cos-backup.sh --dry-run
```

to:

```text
scripts/backup/muledger-local-backup.sh --dry-run
scripts/backup/muledger-local-backup.sh --verify /Volumes/团队文件-DAINTY_SHIPMENT/docker/backups/muledger/snapshots/2026/07/19/muledger-20260719-023000
```

Update `CHANGE_CHECKLIST.md` database, upload, and deployment gates to reference `docs/backup/muledger-local-backup.md`. Update `README.md` with one concise NAS backup link rather than operational details.

- [x] **Step 3: Update plan status and engineering records**

Mark this plan `ACTIVE` until real deployment finishes. Record that the design was user-approved, COS writes were removed by request, the same-NAS limitation was accepted, and production migration still waits for a verified snapshot. Do not mark the sync rollout complete before the final controlled reconcile gate.

- [x] **Step 4: Bump the version single source**

Run:

```bash
npm version 1.0.210 --no-git-tag-version
```

Expected: only `package.json` and the two version locations in `package-lock.json` change from `1.0.209` to `1.0.210`; `src/lib/app-version.ts` continues reading `package.json`.

- [x] **Step 5: Run documentation and focused verification**

```bash
git diff --check
npm test -- scripts/backup/muledger-local-backup.test.ts scripts/rebuild-local-app.test.ts --runInBand
npx prisma validate
npm run typecheck
npm run lint
```

Expected: all commands exit 0; active backup documentation has no COS credentials, endpoints, or commands.

- [ ] **Step 6: Commit docs and version**

```bash
git add README.md CHANGE_CHECKLIST.md ENGINEERING_LOG.md todolist.md docs package.json package-lock.json
git commit -m "docs(backup): make NAS snapshots authoritative"
```

### Task 5: Complete Repository Verification, PR, And CI

**Files:**
- Verify all changed files from Tasks 1-4.

- [ ] **Step 1: Run the complete project gates**

```bash
npm run test:ci
npm run build
npm run i18n:audit
npm audit
npm audit --omit=dev
git diff --check origin/main...HEAD
```

Expected: typecheck, ESLint, Jest, isolated API, isolated Playwright, production build, i18n, both dependency audits, and diff checks all pass. Test containers and temporary volumes created by the isolated test project must be removed by its existing trap.

- [ ] **Step 2: Push and open a draft PR**

Push `ops/muledger-nas-local-backup` and open a draft PR describing:

- why COS was removed;
- the accepted same-NAS limitation;
- atomic snapshot/retention safety;
- automated test evidence;
- no production database or NAS mutation during implementation.

- [ ] **Step 3: Monitor PR CI to completion**

Use:

```bash
PR_NUMBER="$(gh pr view --json number --jq .number)"
gh pr checks "$PR_NUMBER" --watch
```

If CI fails, inspect the exact GitHub Actions log, fix only the observed issue, rerun local focused checks, push, and wait again. Do not merge with pending or failed checks.

- [ ] **Step 4: Mark ready, record review evidence, and merge normally**

Post the review conclusion online, mark the PR ready, merge with a normal merge commit, and monitor the resulting `main` CI until it completes successfully.

### Task 6: Install Local Backup And Resume Safe Deployment

**Files:**
- Create: `docs/backup/restore-drills/2026-07-19-muledger-nas-local-backup-rollout.md`
- Runtime-only local files: `~/.muledger-backup/muledger-backup.env`, `~/.muledger-backup/cos.yaml`, LaunchAgent plist.

- [ ] **Step 1: Fast-forward the clean local main checkout**

Verify `git status --short` is empty, fetch `origin`, and fast-forward only:

```bash
git pull --ff-only origin main
```

Do not reset or overwrite unrelated changes.

- [ ] **Step 2: Convert the mode-600 backup environment without exposing values**

Read the existing `DATABASE_URL` and `UPLOAD_HOST_DIR` in-process, write a new temporary mode-600 file containing only the seven approved local keys, then atomically replace `~/.muledger-backup/muledger-backup.env`. Validate key names and permissions without printing values.

- [ ] **Step 3: Install the local LaunchAgent and create a real snapshot**

```bash
scripts/backup/install-muledger-backup-launchd.sh
scripts/backup/muledger-local-backup.sh --dry-run
scripts/backup/muledger-local-backup.sh
LATEST_SNAPSHOT="$(find /Volumes/团队文件-DAINTY_SHIPMENT/docker/backups/muledger/snapshots -mindepth 4 -maxdepth 4 -type d -name 'muledger-*' | sort | tail -1)"
test -n "$LATEST_SNAPSHOT"
scripts/backup/muledger-local-backup.sh --verify "$LATEST_SNAPSHOT"
```

Expected: new `com.muledger.local-backup` job loaded, old COS job absent, complete snapshot atomically published, checksums and manifest valid, and no existing snapshot removed unless older than 30 days.

- [ ] **Step 4: Remove local MULEDGER COS credentials after snapshot verification**

Delete only `~/.muledger-backup/cos.yaml` and confirm the active env contains no `COS_*` keys. Do not invoke COS delete APIs and do not remove the global `coscli` executable.

- [ ] **Step 5: Repeat the isolated migration against the exact new snapshot**

Restore the dump to an unmounted MariaDB 10.6 container on a loopback-only temporary port. Record pre/post counts and row fingerprints for `OrderTracker`, `Order`, `Invoice`, `Receipt`, `Detail`, and `Swift`; apply `npx prisma migrate deploy` twice; verify five integration tables exist and are empty; run `mariadb-check`; then remove only the temporary container.

- [ ] **Step 6: Configure the shared source token while synchronization remains disabled**

Generate one 64-hex-character token with `openssl rand -hex 32`. Write it to:

```text
MU Contract .env: MULEDGER_ORDER_SYNC_TOKEN
MULEDGER .env: MU_CONTRACT_SYNC_TOKEN
MULEDGER .env: MU_CONTRACT_SYNC_BASE_URL=http://host.docker.internal:8009
```

Verify equal SHA-256 prefixes without printing the token. Recreate only the MU Contract API service needed to load its token, then confirm unauthenticated feed calls return `401` and authenticated event/snapshot calls return valid v1 responses. Do not rerun MU Contract migrations or change its NAS mounts.

- [ ] **Step 7: Run the MULEDGER safe rebuild script**

Execute `scripts/rebuild-local-app.sh`. It may rebuild/recreate only `app`, `maintenance`, and `mucontract-sync-trigger`; it must not remove MySQL data, Docker volumes, NAS files, or Caddy. If any phase fails, report the full output, exit phase/code, app logs, and data-risk assessment before retrying.

- [ ] **Step 8: Verify production migration with synchronization disabled**

Through the running app container, verify:

- version `1.0.210`;
- all 26 Prisma migrations completed with none pending;
- five integration tables exist and contain zero rows;
- protected business table counts still match the pre-deployment snapshot;
- authenticated application health and Orders/settings APIs respond;
- integration status reports disabled and initial reconcile incomplete;
- trigger requests do not create links, conflicts, or event receipts while disabled.

- [ ] **Step 9: Create Full Reconcile preview and stop for business confirmation**

Use an ADMIN-authenticated API session to request `preview-reconcile`. Record source total, metadata-only links, new Orders, conflicts, unmatched customers, and MULEDGER-only rows. Do not apply the preview and do not enable incremental synchronization until the user confirms those counts.

- [ ] **Step 10: Record operational evidence and push the final documentation update**

Write the actual snapshot name/hash, migration counts, protected fingerprints, service versions, container status, API results, preview summary, rollback snapshot, and COS-removal evidence to the rollout document. Update `ENGINEERING_LOG.md`, `todolist.md`, and the plan status index, commit on a small documentation branch, open/merge a PR, and monitor final `main` CI.

## Completion Criteria

- No active MULEDGER script, config example, LaunchAgent, README, or runbook writes to Tencent COS.
- A verified, timestamped database-plus-media snapshot exists under `/Volumes/团队文件-DAINTY_SHIPMENT/docker/backups/muledger`.
- Daily local LaunchAgent is loaded for `02:30`, with 30-day post-success retention.
- Local MULEDGER COS credentials are removed; remote historical objects remain untouched.
- The production migration is applied only after the real snapshot and isolated restore pass.
- MULEDGER and MU Contract source APIs are healthy, but synchronization remains disabled until the user approves the Full Reconcile preview.
