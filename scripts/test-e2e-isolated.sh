#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

BASE_URL="${BASE_URL:-http://127.0.0.1:3200}"
APP_PORT="${APP_PORT:-3200}"
APP_LOG="$(mktemp /tmp/tls-e2e-app.XXXXXX.log)"
UPLOAD_DIR="$(mktemp -d /tmp/tls-e2e-upload.XXXXXX)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.test.yml"
COMPOSE_PROJECT_NAME="trading-ledger-system-e2e"
APP_PID=""

compose() {
  docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
}

cleanup() {
  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" >/dev/null 2>&1; then
    kill "$APP_PID" >/dev/null 2>&1 || true
    wait "$APP_PID" >/dev/null 2>&1 || true
  fi
  compose down -v >/dev/null 2>&1 || true
  rm -f "$APP_LOG"
  rm -rf "$UPLOAD_DIR"
}
trap cleanup EXIT

fail() {
  echo "[FAIL] $1"
  if [ -f "$APP_LOG" ]; then
    echo "--- app log ---"
    tail -n 120 "$APP_LOG" || true
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

npx prisma migrate deploy >/dev/null
npx next dev -p "$APP_PORT" >"$APP_LOG" 2>&1 &
APP_PID="$!"
wait_for_http "$BASE_URL" || fail "app not ready"

PLAYWRIGHT_BASE_URL="$BASE_URL" \
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PW_TEST_INIT_TOKEN="$INIT_ADMIN_TOKEN" \
PW_TEST_ADMIN_EMAIL="$INIT_ADMIN_EMAIL" \
PW_TEST_ADMIN_PASSWORD="$INIT_ADMIN_PASSWORD" \
npx playwright test || fail "playwright end-to-end"

echo "Isolated Playwright tests completed."
