#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

BASE_URL="${BASE_URL:-http://127.0.0.1:3100}"
APP_PORT="${APP_PORT:-3100}"
TMP_BASE="${TMPDIR:-/tmp}"
COOKIE_FILE="$(mktemp "${TMP_BASE}/tls-api-cookie.XXXXXX")"
APP_LOG="$(mktemp "${TMP_BASE}/tls-api-app.XXXXXX")"
SOURCE_LOG="$(mktemp "${TMP_BASE}/tls-mu-contract-source.XXXXXX")"
UPLOAD_DIR="$(mktemp -d "${TMP_BASE}/tls-upload.XXXXXX")"
DIST_DIR=".next-api-isolated"
COMPOSE_FILE="$ROOT_DIR/docker-compose.test.yml"
COMPOSE_PROJECT_NAME="trading-ledger-system-test"
APP_PID=""
SOURCE_PID=""

compose() {
  docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
}

cleanup() {
  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" >/dev/null 2>&1; then
    kill "$APP_PID" >/dev/null 2>&1 || true
    wait "$APP_PID" >/dev/null 2>&1 || true
  fi
  if [ -n "$SOURCE_PID" ] && kill -0 "$SOURCE_PID" >/dev/null 2>&1; then
    kill "$SOURCE_PID" >/dev/null 2>&1 || true
    wait "$SOURCE_PID" >/dev/null 2>&1 || true
  fi
  compose down -v >/dev/null 2>&1 || true
  rm -f "$COOKIE_FILE" "$APP_LOG" "$SOURCE_LOG"
  rm -rf "$UPLOAD_DIR"
  rm -rf "$ROOT_DIR/$DIST_DIR"
}
trap cleanup EXIT

fail() {
  echo "[FAIL] $1"
  if [ -f "$APP_LOG" ]; then
    echo "--- app log ---"
    tail -n 120 "$APP_LOG" || true
  fi
  if [ -f "$SOURCE_LOG" ]; then
    echo "--- MU Contract fake source log ---"
    tail -n 120 "$SOURCE_LOG" || true
  fi
  exit 1
}

wait_for_http() {
  local url="$1"
  for _ in $(seq 1 120); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_mysql() {
  for _ in $(seq 1 60); do
    if compose exec -T mysql mariadb -uroot -prootpass trading_ledger_test -e 'SELECT 1' >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

compose up -d >/dev/null
wait_for_mysql || fail "mysql not ready"
sleep 2

export BASE_URL
export COOKIE_FILE
export DATABASE_URL="mysql://root:rootpass@127.0.0.1:3307/trading_ledger_test"
export SESSION_SECRET="test-session-secret-12345678901234567890"
export MAINTENANCE_JOB_TOKEN="test-maintenance-token-12345678901234567890"
export ENABLE_INIT_ROUTE="true"
export INIT_ADMIN_TOKEN="test-init-token"
export INIT_ADMIN_EMAIL="admin@example.com"
export INIT_ADMIN_PASSWORD="Admin@2026!"
export OCR_DISABLED="true"
export UPLOAD_DIR="$UPLOAD_DIR"
export NEXT_DIST_DIR="$DIST_DIR"
export JSON_BODY_MAX_BYTES="${JSON_BODY_MAX_BYTES:-262144}"
export UPLOAD_BODY_MAX_BYTES="${UPLOAD_BODY_MAX_BYTES:-10485760}"
export MU_CONTRACT_FAKE_PORT="${MU_CONTRACT_FAKE_PORT:-$((3200 + RANDOM % 500))}"
export MU_CONTRACT_FAKE_TOKEN="test-mu-contract-order-sync-token-1234567890"
export MU_CONTRACT_FAKE_CONTROL_TOKEN="test-mu-contract-control-token-1234567890"
export MU_CONTRACT_SYNC_BASE_URL="http://127.0.0.1:${MU_CONTRACT_FAKE_PORT}"
export MU_CONTRACT_SYNC_TOKEN="$MU_CONTRACT_FAKE_TOKEN"

node tests/api/isolated/helpers/mu-contract-order-feed-server.mjs >"$SOURCE_LOG" 2>&1 &
SOURCE_PID="$!"
wait_for_http "$MU_CONTRACT_SYNC_BASE_URL/__control/ready" || fail "MU Contract fake source not ready"

npx prisma migrate deploy >/dev/null
rm -rf "$ROOT_DIR/$DIST_DIR"
# Webpack supports isolated worktrees whose node_modules is shared by symlink.
npx next dev --webpack -p "$APP_PORT" >"$APP_LOG" 2>&1 &
APP_PID="$!"
wait_for_http "$BASE_URL" || fail "app not ready"

node scripts/run-api-isolated-tests.mjs "$@" || fail "isolated API cases"

echo "Isolated API tests completed."
