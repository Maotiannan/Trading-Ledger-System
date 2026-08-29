#!/usr/bin/env bash
set -euo pipefail

umask 077
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_HOME="${MULEDGER_BACKUP_HOME:-$HOME/.muledger-backup}"
ENV_FILE="${MULEDGER_BACKUP_ENV:-$BACKUP_HOME/muledger-backup.env}"
STATUS_FILE="${MULEDGER_BACKUP_STATUS_FILE:-$BACKUP_HOME/status.json}"
DOCKER_BIN="${DOCKER_BIN:-docker}"
MODE="BACKUP"
VERIFY_PATH=""
BACKUP_ARGS=()
STATUS_FINALIZED=0
ATTEMPTS_USED=0
STARTED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

usage() {
  cat <<'USAGE'
Usage:
  scripts/backup/run-muledger-local-backup-docker.sh [--env ENV_PATH]
  scripts/backup/run-muledger-local-backup-docker.sh [--env ENV_PATH] --dry-run
  scripts/backup/run-muledger-local-backup-docker.sh [--env ENV_PATH] --verify SNAPSHOT_DIRECTORY
USAGE
}

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2
}

validate_env_file_permissions() {
  local env_path="$1" env_mode
  if stat -f '%Lp' "$env_path" >/dev/null 2>&1; then
    env_mode="$(stat -f '%Lp' "$env_path")"
  else
    env_mode="$(stat -c '%a' "$env_path")"
  fi
  [ "$env_mode" = "600" ] || {
    log "ERROR: Backup environment file must use mode 600: $env_path"
    return 1
  }
}

validate_positive_integer() {
  local name="$1" value="$2"
  case "$value" in
    ''|*[!0-9]*|0)
      log "ERROR: $name must be a positive integer"
      return 1
      ;;
  esac
}

validate_non_negative_integer() {
  local name="$1" value="$2"
  case "$value" in
    ''|*[!0-9]*)
      log "ERROR: $name must be a non-negative integer"
      return 1
      ;;
  esac
}

write_status() {
  local status="$1" exit_code="$2" attempts="$3" completed_at="$4"
  mkdir -p "$(dirname "$STATUS_FILE")"
  STATUS_FILE="$STATUS_FILE" \
  BACKUP_STATUS="$status" \
  BACKUP_STARTED_AT="$STARTED_AT" \
  BACKUP_COMPLETED_AT="$completed_at" \
  BACKUP_ATTEMPTS="$attempts" \
  BACKUP_EXIT_CODE="$exit_code" \
  BACKUP_MODE="$MODE" \
  BACKUP_GIT_COMMIT="${GIT_COMMIT:-}" \
  BACKUP_MAX_AGE_SECONDS="${MULEDGER_BACKUP_MAX_AGE_SECONDS:-129600}" \
  node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const target = process.env.STATUS_FILE;
let previous = {};
try {
  previous = JSON.parse(fs.readFileSync(target, 'utf8'));
} catch {
  previous = {};
}

const status = process.env.BACKUP_STATUS;
const completedAt = process.env.BACKUP_COMPLETED_AT || null;
const exitCode = process.env.BACKUP_EXIT_CODE === ''
  ? null
  : Number(process.env.BACKUP_EXIT_CODE);
const payload = {
  schemaVersion: 1,
  status,
  startedAt: process.env.BACKUP_STARTED_AT,
  completedAt,
  lastSuccessfulAt: status === 'SUCCESS'
    ? completedAt
    : previous.lastSuccessfulAt || null,
  attempts: Number(process.env.BACKUP_ATTEMPTS || 0),
  exitCode,
  mode: process.env.BACKUP_MODE,
  gitCommit: process.env.BACKUP_GIT_COMMIT || '',
  maxAgeSeconds: Number(process.env.BACKUP_MAX_AGE_SECONDS),
};

fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
const temporary = `${target}.tmp-${process.pid}`;
fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(temporary, target);
NODE
}

handle_exit() {
  local exit_code="$1"
  if [ "$MODE" = "BACKUP" ] && [ "$STATUS_FINALIZED" -eq 0 ]; then
    write_status "FAILED" "$exit_code" "$ATTEMPTS_USED" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" || true
  fi
  trap - EXIT
  exit "$exit_code"
}
trap 'handle_exit $?' EXIT

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      ENV_FILE="$2"
      shift 2
      ;;
    --dry-run)
      [ "$MODE" = "BACKUP" ] || { usage >&2; exit 2; }
      MODE="DRY_RUN"
      BACKUP_ARGS+=("--dry-run")
      shift
      ;;
    --verify)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      [ "$MODE" = "BACKUP" ] || { usage >&2; exit 2; }
      MODE="VERIFY"
      VERIFY_PATH="$2"
      shift 2
      ;;
    -h|--help)
      usage
      STATUS_FINALIZED=1
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done

[ -f "$ENV_FILE" ] || { log "ERROR: Backup environment file not found: $ENV_FILE"; exit 1; }
validate_env_file_permissions "$ENV_FILE"
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
STATUS_FILE="${MULEDGER_BACKUP_STATUS_FILE:-$STATUS_FILE}"

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${UPLOAD_HOST_DIR:?UPLOAD_HOST_DIR is required}"
: "${MULEDGER_LOCAL_BACKUP_ROOT:?MULEDGER_LOCAL_BACKUP_ROOT is required}"

MULEDGER_BACKUP_DOCKER_IMAGE="${MULEDGER_BACKUP_DOCKER_IMAGE:-muledger-local-backup:1}"
MULEDGER_BACKUP_MAX_ATTEMPTS="${MULEDGER_BACKUP_MAX_ATTEMPTS:-3}"
MULEDGER_BACKUP_RETRY_SECONDS="${MULEDGER_BACKUP_RETRY_SECONDS:-300}"
MULEDGER_BACKUP_MAX_AGE_SECONDS="${MULEDGER_BACKUP_MAX_AGE_SECONDS:-129600}"
MULEDGER_BACKUP_TIMEZONE="${MULEDGER_BACKUP_TIMEZONE:-Asia/Shanghai}"
MULEDGER_BACKUP_REQUIRED_MOUNT="${MULEDGER_BACKUP_REQUIRED_MOUNT:-}"
MULEDGER_BACKUP_REQUIRED_FILESYSTEM="${MULEDGER_BACKUP_REQUIRED_FILESYSTEM:-smbfs}"
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-30}"
MULEDGER_BACKUP_MIN_FREE_BYTES="${MULEDGER_BACKUP_MIN_FREE_BYTES:-5368709120}"

validate_positive_integer "MULEDGER_BACKUP_MAX_ATTEMPTS" "$MULEDGER_BACKUP_MAX_ATTEMPTS"
validate_non_negative_integer "MULEDGER_BACKUP_RETRY_SECONDS" "$MULEDGER_BACKUP_RETRY_SECONDS"
validate_positive_integer "MULEDGER_BACKUP_MAX_AGE_SECONDS" "$MULEDGER_BACKUP_MAX_AGE_SECONDS"
case "$UPLOAD_HOST_DIR" in /*) ;; *) log "ERROR: UPLOAD_HOST_DIR must be absolute"; exit 1 ;; esac
case "$MULEDGER_LOCAL_BACKUP_ROOT" in /*) ;; *) log "ERROR: MULEDGER_LOCAL_BACKUP_ROOT must be absolute"; exit 1 ;; esac

if [ -n "$MULEDGER_BACKUP_REQUIRED_MOUNT" ]; then
  case "$UPLOAD_HOST_DIR/" in
    "$MULEDGER_BACKUP_REQUIRED_MOUNT/"*) ;;
    *) log "ERROR: Upload source is outside the required NAS mount"; exit 1 ;;
  esac
  case "$MULEDGER_LOCAL_BACKUP_ROOT/" in
    "$MULEDGER_BACKUP_REQUIRED_MOUNT/"*) ;;
    *) log "ERROR: Backup root is outside the required NAS mount"; exit 1 ;;
  esac
  mount_line="$(mount | grep -F " on $MULEDGER_BACKUP_REQUIRED_MOUNT (" | head -1 || true)"
  if [ -z "$mount_line" ]; then
    log "ERROR: Required NAS mount is not active: $MULEDGER_BACKUP_REQUIRED_MOUNT"
    exit 1
  fi
  if ! printf '%s\n' "$mount_line" | grep -F "($MULEDGER_BACKUP_REQUIRED_FILESYSTEM," >/dev/null; then
    log "ERROR: Required mount does not use $MULEDGER_BACKUP_REQUIRED_FILESYSTEM"
    exit 1
  fi
fi

if [ "$MODE" = "VERIFY" ]; then
  case "$VERIFY_PATH/" in
    "$MULEDGER_LOCAL_BACKUP_ROOT/"*)
      relative_verify_path="${VERIFY_PATH#"$MULEDGER_LOCAL_BACKUP_ROOT"/}"
      BACKUP_ARGS+=("--verify" "/data/backup/$relative_verify_path")
      ;;
    *)
      log "ERROR: Verification path must be inside $MULEDGER_LOCAL_BACKUP_ROOT"
      exit 1
      ;;
  esac
fi

command -v node >/dev/null 2>&1 || { log "ERROR: Missing required command: node"; exit 1; }
[ -x "$DOCKER_BIN" ] || command -v "$DOCKER_BIN" >/dev/null 2>&1 || {
  log "ERROR: Docker CLI is not available: $DOCKER_BIN"
  exit 1
}

GIT_COMMIT="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || true)"
if [ "$MODE" = "BACKUP" ]; then
  write_status "RUNNING" "" 0 ""
fi

"$DOCKER_BIN" info >/dev/null 2>&1 || {
  log "ERROR: Docker Desktop is not running or is unavailable"
  exit 1
}
"$DOCKER_BIN" image inspect "$MULEDGER_BACKUP_DOCKER_IMAGE" >/dev/null 2>&1 || {
  log "ERROR: Backup image is missing: $MULEDGER_BACKUP_DOCKER_IMAGE. Re-run the LaunchAgent installer."
  exit 1
}

docker_args=(
  run
  --rm
  --read-only
  --cap-drop=ALL
  --security-opt=no-new-privileges
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m
  --mount "type=bind,source=$ROOT_DIR,target=/workspace,readonly"
  --mount "type=bind,source=$UPLOAD_HOST_DIR,target=/data/upload,readonly"
  --mount "type=bind,source=$MULEDGER_LOCAL_BACKUP_ROOT,target=/data/backup"
  --workdir /workspace
  -e DATABASE_URL
  -e "UPLOAD_HOST_DIR=/data/upload"
  -e "MULEDGER_LOCAL_BACKUP_ROOT=/data/backup"
  -e "MULEDGER_BACKUP_UPLOAD_SOURCE_LABEL=$UPLOAD_HOST_DIR"
  -e "MULEDGER_BACKUP_GIT_COMMIT=$GIT_COMMIT"
  -e "LOCAL_RETENTION_DAYS=$LOCAL_RETENTION_DAYS"
  -e "MULEDGER_BACKUP_MIN_FREE_BYTES=$MULEDGER_BACKUP_MIN_FREE_BYTES"
  -e "MYSQLDUMP_BIN=auto"
  -e "TZ=$MULEDGER_BACKUP_TIMEZONE"
  "$MULEDGER_BACKUP_DOCKER_IMAGE"
  /workspace/scripts/backup/muledger-local-backup.sh
)
if [ "${#BACKUP_ARGS[@]}" -gt 0 ]; then
  docker_args+=("${BACKUP_ARGS[@]}")
fi

max_attempts=1
if [ "$MODE" = "BACKUP" ]; then max_attempts="$MULEDGER_BACKUP_MAX_ATTEMPTS"; fi
last_exit=1
for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
  ATTEMPTS_USED="$attempt"
  log "Starting $MODE attempt $attempt/$max_attempts through Docker"
  if "$DOCKER_BIN" "${docker_args[@]}"; then
    last_exit=0
    break
  else
    last_exit=$?
  fi
  log "ERROR: $MODE attempt $attempt/$max_attempts failed with exit code $last_exit"
  if [ "$attempt" -lt "$max_attempts" ]; then
    log "Retrying in $MULEDGER_BACKUP_RETRY_SECONDS seconds"
    sleep "$MULEDGER_BACKUP_RETRY_SECONDS"
  fi
done

if [ "$last_exit" -ne 0 ]; then
  if [ "$MODE" = "BACKUP" ]; then
    write_status "FAILED" "$last_exit" "$ATTEMPTS_USED" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    STATUS_FINALIZED=1
  fi
  exit "$last_exit"
fi

if [ "$MODE" = "BACKUP" ]; then
  write_status "SUCCESS" 0 "$ATTEMPTS_USED" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  STATUS_FINALIZED=1
fi
log "$MODE completed successfully"
