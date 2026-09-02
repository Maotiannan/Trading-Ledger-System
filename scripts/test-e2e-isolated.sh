#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

BASE_URL="${BASE_URL:-http://127.0.0.1:3200}"
APP_PORT="${APP_PORT:-3200}"
TMP_BASE="${TMPDIR:-/tmp}"
APP_LOG="$(mktemp "${TMP_BASE}/tls-e2e-app.XXXXXX")"
RESEND_LOG="$(mktemp "${TMP_BASE}/tls-e2e-resend.XXXXXX")"
UPLOAD_DIR="$(mktemp -d "${TMP_BASE}/tls-e2e-upload.XXXXXX")"
DIST_DIR=".next-e2e-isolated"
COMPOSE_FILE="$ROOT_DIR/docker-compose.test.yml"
COMPOSE_PROJECT_NAME="trading-ledger-system-e2e"
APP_PID=""
RESEND_PID=""

compose() {
  docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
}

cleanup() {
  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" >/dev/null 2>&1; then
    kill "$APP_PID" >/dev/null 2>&1 || true
    wait "$APP_PID" >/dev/null 2>&1 || true
  fi
  if [ -n "$RESEND_PID" ] && kill -0 "$RESEND_PID" >/dev/null 2>&1; then
    kill "$RESEND_PID" >/dev/null 2>&1 || true
    wait "$RESEND_PID" >/dev/null 2>&1 || true
  fi
  compose down -v >/dev/null 2>&1 || true
  rm -f "$APP_LOG" "$RESEND_LOG"
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
  if [ -f "$RESEND_LOG" ]; then
    echo "--- fake Resend log ---"
    tail -n 120 "$RESEND_LOG" || true
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

export DATABASE_URL="mysql://root:rootpass@127.0.0.1:3307/trading_ledger_test"
export SESSION_SECRET="test-session-secret-12345678901234567890"
export ENABLE_INIT_ROUTE="true"
export INIT_ADMIN_TOKEN="test-init-token"
export INIT_ADMIN_EMAIL="admin@example.com"
export INIT_ADMIN_PASSWORD="Admin@2026!"
export OCR_DISABLED="true"
export UPLOAD_DIR="$UPLOAD_DIR"
export NEXT_DIST_DIR="$DIST_DIR"
export MAINTENANCE_JOB_TOKEN="test-maintenance-token-12345678901234567890"
export RESEND_FAKE_PORT="${RESEND_FAKE_PORT:-$((4300 + RANDOM % 500))}"
export RESEND_FAKE_CONTROL_TOKEN="test-resend-control-token-1234567890"
export RESEND_FAKE_CONTROL_BASE_URL="http://127.0.0.1:${RESEND_FAKE_PORT}"
export RESEND_API_KEY="re_isolated_test_only"
export RESEND_BASE_URL="$RESEND_FAKE_CONTROL_BASE_URL"
export RESEND_WEBHOOK_SECRET="whsec_dGVzdC1yZXNlbmQtd2ViaG9vay1zZWNyZXQtMzItYnl0ZXMhISE="

node tests/api/isolated/helpers/resend-server.mjs >"$RESEND_LOG" 2>&1 &
RESEND_PID="$!"
wait_for_http "$RESEND_FAKE_CONTROL_BASE_URL/__control/ready" || fail "fake Resend not ready"

npx prisma migrate deploy >/dev/null
rm -rf "$ROOT_DIR/$DIST_DIR"
# Webpack supports isolated worktrees whose node_modules is shared by symlink.
npx next dev --webpack -p "$APP_PORT" >"$APP_LOG" 2>&1 &
APP_PID="$!"
wait_for_http "$BASE_URL" || fail "app not ready"

PLAYWRIGHT_BASE_URL="$BASE_URL" \
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PW_TEST_INIT_TOKEN="$INIT_ADMIN_TOKEN" \
PW_TEST_ADMIN_EMAIL="$INIT_ADMIN_EMAIL" \
PW_TEST_ADMIN_PASSWORD="$INIT_ADMIN_PASSWORD" \
npx playwright test "$@" || fail "playwright end-to-end"

echo "Isolated Playwright tests completed."
