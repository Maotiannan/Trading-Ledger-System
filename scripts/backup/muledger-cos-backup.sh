#!/usr/bin/env bash
set -euo pipefail
umask 077
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_ENV_FILE="$HOME/.muledger-backup/muledger-backup.env"
ENV_FILE="${MULEDGER_BACKUP_ENV:-$DEFAULT_ENV_FILE}"
DRY_RUN=0
CHECK_COS=0
SKIP_DB=0
SKIP_MEDIA=0

usage() {
  cat <<'USAGE'
Usage: scripts/backup/muledger-cos-backup.sh [options]

Options:
  --env <path>      Load backup environment file. Default: ~/.muledger-backup/muledger-backup.env
  --dry-run         Print the plan without dumping database or uploading files.
  --check-cos       Verify COS access by listing the bucket root.
  --skip-db         Skip MySQL dump upload.
  --skip-media      Skip NAS upload directory sync.
  -h, --help        Show this help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --check-cos)
      CHECK_COS=1
      shift
      ;;
    --skip-db)
      SKIP_DB=1
      shift
      ;;
    --skip-media)
      SKIP_MEDIA=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -f "$ROOT_DIR/.env.muledger-backup.local" && "$ENV_FILE" == "$DEFAULT_ENV_FILE" && ! -f "$ENV_FILE" ]]; then
  ENV_FILE="$ROOT_DIR/.env.muledger-backup.local"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cat >&2 <<EOF
Backup env file not found: $ENV_FILE
Create it from scripts/backup/muledger-backup.env.example and fill Tencent COS credentials locally.
EOF
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

COS_BUCKET="${COS_BUCKET:-muledger-backup-prod-1318783232}"
COS_ALIAS="${COS_ALIAS:-muledger-backup-prod}"
COS_REGION="${COS_REGION:-ap-shanghai}"
COS_ENDPOINT="${COS_ENDPOINT:-cos.ap-shanghai.myqcloud.com}"
COS_DB_PREFIX="${COS_DB_PREFIX:-database/mysql}"
COS_MEDIA_PREFIX="${COS_MEDIA_PREFIX:-media/upload}"
COS_MANIFEST_PREFIX="${COS_MANIFEST_PREFIX:-manifests}"
COSCLI_BIN="${COSCLI_BIN:-coscli}"
if [[ "$COSCLI_BIN" == "coscli" && -x "$HOME/.local/bin/coscli" ]]; then
  COSCLI_BIN="$HOME/.local/bin/coscli"
fi
MYSQLDUMP_BIN="${MYSQLDUMP_BIN:-auto}"
MYSQLDUMP_DOCKER_IMAGE="${MYSQLDUMP_DOCKER_IMAGE:-mysql:8}"
MULEDGER_BACKUP_HOME="${MULEDGER_BACKUP_HOME:-$HOME/.muledger-backup}"
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-14}"
UPLOAD_HOST_DIR="${UPLOAD_HOST_DIR:-/Volumes/团队文件-DAINTY_SHIPMENT/docker/trading-ledger-system/upload}"

timestamp="$(date '+%Y%m%d-%H%M%S')"
today="$(date '+%Y/%m/%d')"
RUN_DIR="$MULEDGER_BACKUP_HOME/runs/$timestamp"
LOG_DIR="$MULEDGER_BACKUP_HOME/logs"
SNAPSHOT_DIR="$MULEDGER_BACKUP_HOME/snapshots"
COS_CONFIG_PATH="${COS_CONFIG_PATH:-$MULEDGER_BACKUP_HOME/cos.yaml}"
mkdir -p "$RUN_DIR" "$LOG_DIR" "$SNAPSHOT_DIR" "$(dirname "$COS_CONFIG_PATH")"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1" >&2
    exit 1
  fi
}

shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

write_cos_config() {
  if [[ -z "${COS_SECRET_ID:-}" || -z "${COS_SECRET_KEY:-}" ]]; then
    if [[ ! -f "$COS_CONFIG_PATH" ]]; then
      echo "COS_SECRET_ID/COS_SECRET_KEY are empty and COS config does not exist: $COS_CONFIG_PATH" >&2
      exit 1
    fi
    return
  fi

  cat > "$COS_CONFIG_PATH" <<EOF
cos:
  base:
    secretid: $(printf '%s' "$COS_SECRET_ID")
    secretkey: $(printf '%s' "$COS_SECRET_KEY")
    sessiontoken: "$(printf '%s' "${COS_SESSION_TOKEN:-}")"
    protocol: https
  buckets:
  - name: $COS_BUCKET
    alias: $COS_ALIAS
    region: $COS_REGION
    endpoint: $COS_ENDPOINT
    ofs: false
EOF
  chmod 600 "$COS_CONFIG_PATH"
}

get_database_url() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    printf '%s' "$DATABASE_URL"
    return
  fi
  if command -v docker >/dev/null 2>&1; then
    (cd "$ROOT_DIR" && docker compose exec -T app printenv DATABASE_URL 2>/dev/null || true)
  fi
}

parse_database_url() {
  local database_url="$1"
  DATABASE_URL="$database_url" node > "$RUN_DIR/db.env" <<'NODE'
const raw = process.env.DATABASE_URL || '';
if (!raw) {
  console.error('DATABASE_URL is empty');
  process.exit(1);
}
const url = new URL(raw);
const q = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
const values = {
  DB_HOST: url.hostname,
  DB_PORT: url.port || '3306',
  DB_USER: decodeURIComponent(url.username),
  DB_PASSWORD: decodeURIComponent(url.password),
  DB_NAME: database,
};
for (const [key, value] of Object.entries(values)) {
  console.log(`${key}=${q(value)}`);
}
NODE
  # shellcheck disable=SC1091
  . "$RUN_DIR/db.env"
}

sha256_file() {
  local file="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" > "$file.sha256"
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" > "$file.sha256"
  else
    echo "Missing shasum or sha256sum" >&2
    exit 1
  fi
}

dump_database() {
  local database_url="$1"
  parse_database_url "$database_url"

  local dump_file="$RUN_DIR/trading_ledger-$timestamp.sql.gz"
  local common_args=(
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
  if [[ "$MYSQLDUMP_BIN" != "auto" ]]; then
    require_cmd "$MYSQLDUMP_BIN"
    MYSQL_PWD="$DB_PASSWORD" "$MYSQLDUMP_BIN" "${common_args[@]}" | gzip -9 > "$dump_file"
  elif command -v mysqldump >/dev/null 2>&1; then
    MYSQL_PWD="$DB_PASSWORD" mysqldump "${common_args[@]}" | gzip -9 > "$dump_file"
  elif command -v mariadb-dump >/dev/null 2>&1; then
    MYSQL_PWD="$DB_PASSWORD" mariadb-dump "${common_args[@]}" | gzip -9 > "$dump_file"
  else
    require_cmd docker
    log "mysqldump not found locally. Using Docker image $MYSQLDUMP_DOCKER_IMAGE as a client only."
    docker run --rm \
      -e MYSQL_PWD="$DB_PASSWORD" \
      "$MYSQLDUMP_DOCKER_IMAGE" \
      mysqldump "${common_args[@]}" | gzip -9 > "$dump_file"
  fi

  gzip -t "$dump_file"
  sha256_file "$dump_file"
  printf '%s' "$dump_file"
}

cos_cp() {
  "$COSCLI_BIN" cp "$1" "$2" -c "$COS_CONFIG_PATH"
}

cos_sync() {
  "$COSCLI_BIN" sync "$1" "$2" -r -c "$COS_CONFIG_PATH" --snapshot-path "$3"
}

write_manifest() {
  local manifest="$RUN_DIR/manifest.json"
  local db_object="${1:-}"
  local media_prefix="${2:-}"
  local git_commit
  git_commit="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || true)"
  BACKUP_GIT_COMMIT="$git_commit" \
  BACKUP_COS_BUCKET="$COS_BUCKET" \
  BACKUP_DB_OBJECT="$db_object" \
  BACKUP_MEDIA_PREFIX="$media_prefix" \
  BACKUP_UPLOAD_HOST_DIR="$UPLOAD_HOST_DIR" \
  node > "$manifest" <<'NODE'
const fs = require('fs');
const manifest = {
  project: 'muledger',
  generatedAt: new Date().toISOString(),
  host: require('os').hostname(),
  gitCommit: process.env.BACKUP_GIT_COMMIT || '',
  bucket: process.env.BACKUP_COS_BUCKET || '',
  databaseObject: process.env.BACKUP_DB_OBJECT || '',
  mediaPrefix: process.env.BACKUP_MEDIA_PREFIX || '',
  uploadHostDir: process.env.BACKUP_UPLOAD_HOST_DIR || '',
};
fs.writeFileSync(process.stdout.fd, JSON.stringify(manifest, null, 2) + '\n');
NODE
  printf '%s' "$manifest"
}

cleanup_old_local_runs() {
  if [[ "$LOCAL_RETENTION_DAYS" =~ ^[0-9]+$ && "$LOCAL_RETENTION_DAYS" -gt 0 ]]; then
    find "$MULEDGER_BACKUP_HOME/runs" -mindepth 1 -maxdepth 1 -type d -mtime +"$LOCAL_RETENTION_DAYS" -print -exec rm -rf {} + 2>/dev/null || true
  fi
}

log "Loading backup env: $ENV_FILE"
log "COS bucket: $COS_BUCKET ($COS_REGION)"
log "COS endpoint: $COS_ENDPOINT"
log "Run dir: $RUN_DIR"
log "Upload dir: $UPLOAD_HOST_DIR"

if [[ "$DRY_RUN" -eq 1 ]]; then
  log "Dry run only. No database dump or COS upload will be performed."
fi

require_cmd node
require_cmd gzip
if [[ "$DRY_RUN" -eq 0 || "$CHECK_COS" -eq 1 ]]; then
  require_cmd "$COSCLI_BIN"
  write_cos_config
fi

if [[ "$CHECK_COS" -eq 1 ]]; then
  log "Checking COS access"
  "$COSCLI_BIN" ls "cos://$COS_ALIAS/" -c "$COS_CONFIG_PATH" >/dev/null
  log "COS access check passed"
fi

db_object=""
media_prefix=""

if [[ "$SKIP_DB" -eq 0 ]]; then
  database_url="$(get_database_url)"
  if [[ -z "$database_url" ]]; then
    echo "DATABASE_URL is empty. Set it in $ENV_FILE or keep the app container running." >&2
    exit 1
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "Would dump database from DATABASE_URL and upload to cos://$COS_ALIAS/$COS_DB_PREFIX/$today/"
  else
    dump_file="$(dump_database "$database_url")"
    dump_name="$(basename "$dump_file")"
    db_object="$COS_DB_PREFIX/$today/$dump_name"
    log "Uploading database dump: cos://$COS_ALIAS/$db_object"
    cos_cp "$dump_file" "cos://$COS_ALIAS/$db_object"
    cos_cp "$dump_file.sha256" "cos://$COS_ALIAS/$db_object.sha256"
  fi
fi

if [[ "$SKIP_MEDIA" -eq 0 ]]; then
  if [[ ! -d "$UPLOAD_HOST_DIR" ]]; then
    echo "UPLOAD_HOST_DIR does not exist: $UPLOAD_HOST_DIR" >&2
    exit 1
  fi
  media_prefix="$COS_MEDIA_PREFIX/"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "Would sync $UPLOAD_HOST_DIR/ to cos://$COS_ALIAS/$media_prefix"
  else
    log "Syncing media files to cos://$COS_ALIAS/$media_prefix"
    cos_sync "$UPLOAD_HOST_DIR/" "cos://$COS_ALIAS/$media_prefix" "$SNAPSHOT_DIR/media-upload"
  fi
fi

if [[ "$DRY_RUN" -eq 0 ]]; then
  manifest="$(write_manifest "$db_object" "$media_prefix")"
  manifest_object="$COS_MANIFEST_PREFIX/$today/muledger-backup-$timestamp.json"
  log "Uploading manifest: cos://$COS_ALIAS/$manifest_object"
  cos_cp "$manifest" "cos://$COS_ALIAS/$manifest_object"
  cleanup_old_local_runs
  log "Backup completed"
else
  log "Dry run completed"
fi
