#!/usr/bin/env bash
set -euo pipefail

umask 077
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
export COPYFILE_DISABLE=1

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_ENV_FILE="$HOME/.muledger-backup/muledger-backup.env"
ENV_FILE="${MULEDGER_BACKUP_ENV:-$DEFAULT_ENV_FILE}"
ENV_EXPLICIT=0
DRY_RUN=0
VERIFY_PATH=""
LOCK_ACQUIRED=0
LOCK_TOKEN=""
LOCK_DIR=""
STAGING_DIR=""

usage() {
  cat <<'USAGE'
Usage:
  scripts/backup/muledger-local-backup.sh [--env ENV_PATH] [--dry-run]
  scripts/backup/muledger-local-backup.sh [--env ENV_PATH] --verify SNAPSHOT_DIRECTORY

Options:
  --env PATH       Load a mode-600 backup environment file.
  --dry-run        Validate and print the plan without writing or deleting files.
  --verify PATH    Verify one published snapshot without restoring it.
  -h, --help       Show this help.
USAGE
}

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2
}

fail() {
  log "ERROR: $*"
  exit 1
}

cleanup() {
  exit_code=$?
  if [ -n "$STAGING_DIR" ] && [ -d "$STAGING_DIR" ]; then
    find "$STAGING_DIR" -depth -delete 2>/dev/null || true
  fi
  if [ "$LOCK_ACQUIRED" -eq 1 ] && [ -n "$LOCK_DIR" ] && [ -d "$LOCK_DIR" ]; then
    recorded_token="$(sed -n 's/.*"token":"\([^"]*\)".*/\1/p' "$LOCK_DIR/owner.json" 2>/dev/null || true)"
    if [ "$recorded_token" = "$LOCK_TOKEN" ]; then
      rm -f "$LOCK_DIR/owner.json"
      rmdir "$LOCK_DIR" 2>/dev/null || true
    fi
  fi
  exit "$exit_code"
}
trap cleanup EXIT

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env)
      [ "$#" -ge 2 ] || fail "--env requires a path"
      ENV_FILE="$2"
      ENV_EXPLICIT=1
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --verify)
      [ "$#" -ge 2 ] || fail "--verify requires a snapshot directory"
      VERIFY_PATH="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      fail "Unknown option: $1"
      ;;
  esac
done

if [ "$DRY_RUN" -eq 1 ] && [ -n "$VERIFY_PATH" ]; then
  fail "--dry-run and --verify cannot be used together"
fi

validate_env_file_permissions() {
  env_path="$1"
  if stat -f '%Lp' "$env_path" >/dev/null 2>&1; then
    env_mode="$(stat -f '%Lp' "$env_path")"
  else
    env_mode="$(stat -c '%a' "$env_path")"
  fi
  [ "$env_mode" = "600" ] || fail "Backup environment file must use mode 600: $env_path"
}

if [ "$ENV_EXPLICIT" -eq 1 ]; then
  [ -f "$ENV_FILE" ] || fail "Backup environment file not found: $ENV_FILE"
  validate_env_file_permissions "$ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
elif [ -z "${DATABASE_URL:-}" ] && [ -f "$ENV_FILE" ]; then
  validate_env_file_permissions "$ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

MULEDGER_LOCAL_BACKUP_ROOT="${MULEDGER_LOCAL_BACKUP_ROOT:-/Volumes/团队文件-DAINTY_SHIPMENT/docker/backups/muledger}"
UPLOAD_HOST_DIR="${UPLOAD_HOST_DIR:-/Volumes/团队文件-DAINTY_SHIPMENT/docker/trading-ledger-system/upload}"
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-30}"
MULEDGER_BACKUP_MIN_FREE_BYTES="${MULEDGER_BACKUP_MIN_FREE_BYTES:-5368709120}"
MYSQLDUMP_BIN="${MYSQLDUMP_BIN:-auto}"
MYSQLDUMP_DOCKER_IMAGE="${MYSQLDUMP_DOCKER_IMAGE:-mariadb:10.6}"

case "$LOCAL_RETENTION_DAYS" in
  ''|*[!0-9]*) fail "LOCAL_RETENTION_DAYS must be a non-negative integer" ;;
esac
case "$MULEDGER_BACKUP_MIN_FREE_BYTES" in
  ''|*[!0-9]*) fail "MULEDGER_BACKUP_MIN_FREE_BYTES must be a non-negative integer" ;;
esac

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

resolve_directory() {
  directory="$1"
  [ -d "$directory" ] || fail "Directory does not exist: $directory"
  (cd "$directory" && pwd -P)
}

file_size() {
  target="$1"
  if stat -f '%z' "$target" >/dev/null 2>&1; then
    stat -f '%z' "$target"
  else
    stat -c '%s' "$target"
  fi
}

sha256_value() {
  target="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$target" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$target" | awk '{print $1}'
  else
    fail "Missing shasum or sha256sum"
  fi
}

write_checksum() {
  target="$1"
  printf '%s  %s\n' "$(sha256_value "$target")" "$(basename "$target")" > "$target.sha256"
}

verify_checksum() {
  target="$1"
  checksum="$target.sha256"
  [ -f "$checksum" ] || fail "Snapshot checksum file is missing: $checksum"
  if command -v shasum >/dev/null 2>&1; then
    (cd "$(dirname "$target")" && shasum -a 256 -c "$(basename "$checksum")" >/dev/null) || \
      fail "Snapshot checksum validation failed: $target"
  elif command -v sha256sum >/dev/null 2>&1; then
    (cd "$(dirname "$target")" && sha256sum -c "$(basename "$checksum")" >/dev/null) || \
      fail "Snapshot checksum validation failed: $target"
  else
    fail "Missing shasum or sha256sum"
  fi
}

validate_no_overlap() {
  upload_root="$1"
  backup_root="$2"
  if [ "$upload_root" = "$backup_root" ]; then
    fail "Backup path overlap: source and backup root are identical"
  fi
  case "$backup_root/" in
    "$upload_root/"*) fail "Backup path overlap: backup root is inside the upload source" ;;
  esac
  case "$upload_root/" in
    "$backup_root/"*) fail "Backup path overlap: upload source is inside the backup root" ;;
  esac
}

validate_media_source() {
  upload_root="$1"
  [ ! -L "$UPLOAD_HOST_DIR" ] || fail "Media source is a symbolic link: $UPLOAD_HOST_DIR"
  symbolic_link="$(find "$upload_root" -type l -print -quit)"
  [ -z "$symbolic_link" ] || fail "Media source contains a symbolic link: $symbolic_link"
  unsafe_file="$(find "$upload_root" ! -type f ! -type d -print -quit)"
  [ -z "$unsafe_file" ] || fail "Media source contains an unsafe file type: $unsafe_file"
}

validate_free_space() {
  backup_root="$1"
  minimum_kb=$(( (MULEDGER_BACKUP_MIN_FREE_BYTES + 1023) / 1024 ))
  available_kb="$(df -Pk "$backup_root" | awk 'END {print $4}')"
  case "$available_kb" in
    ''|*[!0-9]*) fail "Unable to determine available backup space" ;;
  esac
  if [ "$available_kb" -lt "$minimum_kb" ]; then
    fail "NAS has insufficient free space for a safe backup"
  fi
}

validate_archive_members() {
  media_archive="$1"
  unsafe_member=0
  while IFS= read -r member; do
    case "$member" in
      /*|../*|*/../*|*/..) unsafe_member=1; break ;;
    esac
  done < <(tar -tzf "$media_archive")
  [ "$unsafe_member" -eq 0 ] || fail "Media archive contains an unsafe path"

  if ! tar -tvzf "$media_archive" | awk '
    {
      type = substr($0, 1, 1)
      if (type != "-" && type != "d") exit 1
    }
  '; then
    fail "Media archive contains an unsafe file type"
  fi
}

verify_snapshot_payload() {
  snapshot="$1"
  [ -d "$snapshot" ] || fail "Snapshot directory does not exist: $snapshot"
  manifest="$snapshot/manifest.json"
  [ -f "$manifest" ] || fail "Snapshot manifest is missing: $manifest"
  [ -f "$manifest.sha256" ] || fail "Snapshot manifest checksum is missing"
  verify_checksum "$manifest"

  database_relative="$(node -e '
    const fs = require("fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(String(value.database?.file || ""));
  ' "$manifest")"
  media_relative="$(node -e '
    const fs = require("fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(String(value.media?.file || ""));
  ' "$manifest")"

  case "$database_relative" in
    database/*.sql.gz) ;;
    *) fail "Snapshot manifest has an unsafe database file path" ;;
  esac
  case "$media_relative" in
    media/*.tar.gz) ;;
    *) fail "Snapshot manifest has an unsafe media file path" ;;
  esac
  case "$database_relative$media_relative" in
    *..*|*\\*) fail "Snapshot manifest contains path traversal" ;;
  esac

  database_dump="$snapshot/$database_relative"
  media_archive="$snapshot/$media_relative"
  [ -f "$database_dump" ] || fail "Snapshot database dump is missing"
  [ -f "$media_archive" ] || fail "Snapshot media archive is missing"
  verify_checksum "$database_dump"
  verify_checksum "$media_archive"
  gzip -t "$database_dump" || fail "Snapshot database gzip validation failed"
  tar -tzf "$media_archive" >/dev/null || fail "Snapshot media gzip validation failed"
  validate_archive_members "$media_archive"

  archive_file_count="$(tar -tvzf "$media_archive" | awk 'substr($0, 1, 1) == "-" {count++} END {print count + 0}')"
  SNAPSHOT_DIR="$snapshot" ARCHIVE_FILE_COUNT="$archive_file_count" node <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.SNAPSHOT_DIR;
const manifestPath = path.join(root, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fail = (message) => {
  console.error(`Snapshot manifest validation failed: ${message}`);
  process.exit(1);
};

if (manifest.project !== 'muledger' || manifest.formatVersion !== 1) fail('identity');
if (manifest.databaseName !== 'trading_ledger') fail('database name');
for (const sectionName of ['database', 'media']) {
  const section = manifest[sectionName];
  if (!section || typeof section.file !== 'string') fail(`${sectionName} file`);
  const file = path.join(root, section.file);
  if (fs.statSync(file).size !== section.sizeBytes) fail(`${sectionName} size`);
  if (digest(file) !== section.sha256) fail(`${sectionName} sha256`);
}
if (manifest.mediaFileCount !== Number(process.env.ARCHIVE_FILE_COUNT)) fail('media file count');
NODE

  log "Snapshot verification passed: $snapshot"
}

verify_published_snapshot() {
  snapshot="$1"
  [ -d "$snapshot" ] || fail "Snapshot directory does not exist: $snapshot"
  resolved_snapshot="$(resolve_directory "$snapshot")"
  snapshots_root="$BACKUP_ROOT_RESOLVED/snapshots"
  case "$resolved_snapshot/" in
    "$snapshots_root/"*) ;;
    *) fail "Snapshot is outside backup root: $resolved_snapshot" ;;
  esac
  case "$(basename "$resolved_snapshot")" in
    muledger-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]) ;;
    *) fail "Snapshot directory name is invalid" ;;
  esac
  verify_snapshot_payload "$resolved_snapshot"
}

require_cmd node
require_cmd gzip
require_cmd tar
require_cmd find
require_cmd df

if [ -n "$VERIFY_PATH" ]; then
  [ -d "$MULEDGER_LOCAL_BACKUP_ROOT" ] || fail "Backup root does not exist: $MULEDGER_LOCAL_BACKUP_ROOT"
  BACKUP_ROOT_RESOLVED="$(resolve_directory "$MULEDGER_LOCAL_BACKUP_ROOT")"
  verify_published_snapshot "$VERIFY_PATH"
  exit 0
fi

[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is empty"
[ -d "$UPLOAD_HOST_DIR" ] || fail "Upload source does not exist: $UPLOAD_HOST_DIR"
if [ "$DRY_RUN" -eq 0 ]; then
  mkdir -p "$MULEDGER_LOCAL_BACKUP_ROOT"
else
  [ -d "$MULEDGER_LOCAL_BACKUP_ROOT" ] || fail "Backup root does not exist for dry run: $MULEDGER_LOCAL_BACKUP_ROOT"
fi

UPLOAD_ROOT_RESOLVED="$(resolve_directory "$UPLOAD_HOST_DIR")"
BACKUP_ROOT_RESOLVED="$(resolve_directory "$MULEDGER_LOCAL_BACKUP_ROOT")"
validate_no_overlap "$UPLOAD_ROOT_RESOLVED" "$BACKUP_ROOT_RESOLVED"
validate_media_source "$UPLOAD_ROOT_RESOLVED"
validate_free_space "$BACKUP_ROOT_RESOLVED"

log "Database: trading_ledger"
log "Upload source: $UPLOAD_ROOT_RESOLVED"
log "Local backup root: $BACKUP_ROOT_RESOLVED"
log "Retention: $LOCAL_RETENTION_DAYS days"

if [ "$DRY_RUN" -eq 1 ]; then
  log "Dry run only. No database dump, archive, publication, or retention will be performed."
  exit 0
fi

LOCK_DIR="$BACKUP_ROOT_RESOLVED/.backup.lock"
LOCK_TOKEN="$(openssl rand -hex 16 2>/dev/null || printf '%s-%s' "$$" "$(date +%s)")"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  fail "Another MULEDGER local backup is already running: $LOCK_DIR"
fi
LOCK_ACQUIRED=1
printf '{"pid":%s,"token":"%s","startedAt":"%s"}\n' \
  "$$" "$LOCK_TOKEN" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$LOCK_DIR/owner.json"

timestamp="$(date '+%Y%m%d-%H%M%S')"
day_path="$(date '+%Y/%m/%d')"
staging_root="$BACKUP_ROOT_RESOLVED/.staging"
mkdir -p "$staging_root"
STAGING_DIR="$staging_root/muledger-$timestamp-$$"
mkdir -p "$STAGING_DIR/database" "$STAGING_DIR/media"

parse_database_url() {
  database_url="$1"
  DATABASE_URL="$database_url" node > "$STAGING_DIR/db.env" <<'NODE'
const raw = process.env.DATABASE_URL || '';
const url = new URL(raw);
if (!['mysql:', 'mariadb:'].includes(url.protocol)) {
  console.error('DATABASE_URL must use mysql or mariadb');
  process.exit(1);
}
const quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
const values = {
  DB_HOST: url.hostname,
  DB_PORT: url.port || '3306',
  DB_USER: decodeURIComponent(url.username),
  DB_PASSWORD: decodeURIComponent(url.password),
  DB_NAME: decodeURIComponent(url.pathname.replace(/^\/+/, '')),
};
if (!values.DB_HOST || !values.DB_USER || !values.DB_NAME) process.exit(1);
for (const [key, value] of Object.entries(values)) console.log(`${key}=${quote(value)}`);
NODE
  # shellcheck disable=SC1091
  . "$STAGING_DIR/db.env"
  rm -f "$STAGING_DIR/db.env"
}

dump_database() {
  parse_database_url "$DATABASE_URL" || fail "Unable to parse DATABASE_URL"
  [ "$DB_NAME" = "trading_ledger" ] || fail "Refusing to back up a database other than trading_ledger"
  database_dump="$STAGING_DIR/database/trading_ledger-$timestamp.sql.gz"
  dump_args=(
    "--host=$DB_HOST"
    "--port=$DB_PORT"
    "--user=$DB_USER"
    "--single-transaction"
    "--routines"
    "--triggers"
    "--events"
    "--default-character-set=utf8mb4"
    "$DB_NAME"
  )

  log "Dumping MySQL database '$DB_NAME' from $DB_HOST:$DB_PORT"
  if [ "$MYSQLDUMP_BIN" != "auto" ]; then
    [ -x "$MYSQLDUMP_BIN" ] || fail "Configured MYSQLDUMP_BIN is not executable: $MYSQLDUMP_BIN"
    if ! MYSQL_PWD="$DB_PASSWORD" "$MYSQLDUMP_BIN" "${dump_args[@]}" | gzip -9 > "$database_dump"; then
      fail "Database dump failed"
    fi
  elif command -v mysqldump >/dev/null 2>&1; then
    if ! MYSQL_PWD="$DB_PASSWORD" mysqldump "${dump_args[@]}" | gzip -9 > "$database_dump"; then
      fail "Database dump failed"
    fi
  elif command -v mariadb-dump >/dev/null 2>&1; then
    if ! MYSQL_PWD="$DB_PASSWORD" mariadb-dump "${dump_args[@]}" | gzip -9 > "$database_dump"; then
      fail "Database dump failed"
    fi
  else
    require_cmd docker
    log "Using Docker image $MYSQLDUMP_DOCKER_IMAGE as a database client only"
    if ! docker run --rm -e MYSQL_PWD="$DB_PASSWORD" "$MYSQLDUMP_DOCKER_IMAGE" \
      mariadb-dump "${dump_args[@]}" | gzip -9 > "$database_dump"; then
      fail "Database dump failed"
    fi
  fi
  gzip -t "$database_dump" || fail "Database dump gzip validation failed"
  write_checksum "$database_dump"
}

archive_media() {
  media_archive="$STAGING_DIR/media/upload-$timestamp.tar.gz"
  MEDIA_FILE_COUNT="$(find "$UPLOAD_ROOT_RESOLVED" -type f | wc -l | tr -d '[:space:]')"
  log "Archiving $MEDIA_FILE_COUNT media files"
  tar -C "$UPLOAD_ROOT_RESOLVED" -czf "$media_archive" . || fail "Media archive failed"
  tar -tzf "$media_archive" >/dev/null || fail "Media archive gzip validation failed"
  write_checksum "$media_archive"
}

write_manifest() {
  database_dump="$(find "$STAGING_DIR/database" -type f -name '*.sql.gz' -print -quit)"
  media_archive="$(find "$STAGING_DIR/media" -type f -name '*.tar.gz' -print -quit)"
  database_relative="database/$(basename "$database_dump")"
  media_relative="media/$(basename "$media_archive")"
  git_commit="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || true)"
  BACKUP_CREATED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  BACKUP_GIT_COMMIT="$git_commit" \
  BACKUP_DATABASE_FILE="$database_relative" \
  BACKUP_DATABASE_SIZE="$(file_size "$database_dump")" \
  BACKUP_DATABASE_SHA256="$(sha256_value "$database_dump")" \
  BACKUP_MEDIA_FILE="$media_relative" \
  BACKUP_MEDIA_SIZE="$(file_size "$media_archive")" \
  BACKUP_MEDIA_SHA256="$(sha256_value "$media_archive")" \
  BACKUP_MEDIA_COUNT="$MEDIA_FILE_COUNT" \
  BACKUP_UPLOAD_SOURCE="$UPLOAD_ROOT_RESOLVED" \
  node > "$STAGING_DIR/manifest.json" <<'NODE'
const manifest = {
  project: 'muledger',
  formatVersion: 1,
  createdAt: process.env.BACKUP_CREATED_AT,
  gitCommit: process.env.BACKUP_GIT_COMMIT || '',
  databaseName: 'trading_ledger',
  uploadSource: process.env.BACKUP_UPLOAD_SOURCE,
  mediaFileCount: Number(process.env.BACKUP_MEDIA_COUNT),
  database: {
    file: process.env.BACKUP_DATABASE_FILE,
    sizeBytes: Number(process.env.BACKUP_DATABASE_SIZE),
    sha256: process.env.BACKUP_DATABASE_SHA256,
  },
  media: {
    file: process.env.BACKUP_MEDIA_FILE,
    sizeBytes: Number(process.env.BACKUP_MEDIA_SIZE),
    sha256: process.env.BACKUP_MEDIA_SHA256,
  },
};
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
NODE
  write_checksum "$STAGING_DIR/manifest.json"
}

apply_retention() {
  [ "$LOCAL_RETENTION_DAYS" -gt 0 ] || return 0
  snapshots_root="$BACKUP_ROOT_RESOLVED/snapshots"
  [ -d "$snapshots_root" ] || return 0
  find "$snapshots_root" -mindepth 4 -maxdepth 4 -type d -name 'muledger-*' \
    -mtime +"$LOCAL_RETENTION_DAYS" -print | while IFS= read -r candidate; do
      candidate_resolved="$(resolve_directory "$candidate")"
      case "$candidate_resolved/" in
        "$snapshots_root/"*) ;;
        *) fail "Retention candidate escaped backup root: $candidate_resolved" ;;
      esac
      candidate_name="$(basename "$candidate_resolved")"
      if ! printf '%s\n' "$candidate_name" | grep -Eq '^muledger-[0-9]{8}-[0-9]{6}$'; then
        fail "Retention candidate has an unsafe name: $candidate_name"
      fi
      log "Removing expired snapshot: $candidate_resolved"
      find "$candidate_resolved" -depth -delete
    done
}

dump_database
archive_media
write_manifest
verify_snapshot_payload "$STAGING_DIR"

final_parent="$BACKUP_ROOT_RESOLVED/snapshots/$day_path"
final_snapshot="$final_parent/muledger-$timestamp"
[ ! -e "$final_snapshot" ] || fail "Snapshot already exists: $final_snapshot"
mkdir -p "$final_parent"
mv "$STAGING_DIR" "$final_snapshot"
STAGING_DIR=""
log "Snapshot published: $final_snapshot"
apply_retention
log "Local backup completed"
