#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

BASE_URL="http://127.0.0.1:3100"
COOKIE_FILE="$(mktemp /tmp/tls-api-cookie.XXXXXX)"
APP_LOG="$(mktemp /tmp/tls-api-app.XXXXXX.log)"
UPLOAD_DIR="$(mktemp -d /tmp/tls-upload.XXXXXX)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.test.yml"
COMPOSE_PROJECT_NAME="trading-ledger-system-test"
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
  rm -f "$COOKIE_FILE" "$APP_LOG"
  rm -rf "$UPLOAD_DIR"
}
trap cleanup EXIT

pass() { echo "[PASS] $1"; }
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

request_json() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local body_file
  body_file="$(mktemp /tmp/tls-api-body.XXXXXX.json)"
  local code

  if [ -n "$data" ]; then
    code=$(curl -sS -o "$body_file" -w "%{http_code}" -b "$COOKIE_FILE" -c "$COOKIE_FILE" -X "$method" "$BASE_URL$path" -H "Content-Type: application/json" --data "$data")
  else
    code=$(curl -sS -o "$body_file" -w "%{http_code}" -b "$COOKIE_FILE" -c "$COOKIE_FILE" -X "$method" "$BASE_URL$path")
  fi

  if [ "$code" -ge 400 ]; then
    cat "$body_file"
    rm -f "$body_file"
    return 1
  fi

  cat "$body_file"
  rm -f "$body_file"
}

request_code() {
  local expected="$1"
  local method="$2"
  local path="$3"
  local data="${4:-}"
  local body_file
  body_file="$(mktemp /tmp/tls-api-code.XXXXXX.json)"
  local code

  if [ -n "$data" ]; then
    code=$(curl -sS -o "$body_file" -w "%{http_code}" -b "$COOKIE_FILE" -c "$COOKIE_FILE" -X "$method" "$BASE_URL$path" -H "Content-Type: application/json" --data "$data")
  else
    code=$(curl -sS -o "$body_file" -w "%{http_code}" -b "$COOKIE_FILE" -c "$COOKIE_FILE" -X "$method" "$BASE_URL$path")
  fi

  if [ "$code" != "$expected" ]; then
    cat "$body_file"
    rm -f "$body_file"
    fail "$method $path expected $expected got $code"
  fi
  rm -f "$body_file"
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
npx next dev -p 3100 >"$APP_LOG" 2>&1 &
APP_PID="$!"
wait_for_http "$BASE_URL" || fail "app not ready"

request_code "401" "GET" "/api/system/health"
pass "unauthorized health"

INIT_CODE=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/init" -H "x-init-token: $INIT_ADMIN_TOKEN")
if [ "$INIT_CODE" != "200" ]; then
  fail "init admin"
fi
pass "init admin"

request_code "200" "POST" "/api/auth" "{\"action\":\"login\",\"email\":\"$INIT_ADMIN_EMAIL\",\"password\":\"$INIT_ADMIN_PASSWORD\"}"
pass "login"

request_code "200" "GET" "/api/system/health"
request_code "200" "GET" "/api/settings"
pass "system endpoints"

request_code "200" "POST" "/api/customer" "{\"action\":\"create\",\"mark\":\"MAB-1\",\"orderName\":\"MAB-1\",\"name\":\"MAB Trading\",\"phone\":\"622443103\",\"city\":\"Conakry\"}"
pass "create customer"

request_code "200" "POST" "/api/invoice" "{\"invNo\":\"INV-TEST-001\",\"orders\":[{\"orderNo\":\"MAB-1-01\",\"amount\":1200,\"customerMark\":\"MAB-1\"}]}"
pass "create invoice"

request_code "200" "POST" "/api/receipt" "{\"action\":\"direct-create\",\"receiptNo\":\"RCPT-001\",\"usd\":1200,\"orderNo\":\"MAB-1-01\",\"customerMark\":\"MAB-1\",\"customerName\":\"MAB-1\"}"
pass "create receipt"

request_code "200" "POST" "/api/detail" "{\"action\":\"direct-create\",\"items\":[{\"orderNo\":\"MAB-1-01\",\"amount\":1200}]}"
pass "create detail"

DETAIL_JSON="$(curl -sS -b "$COOKIE_FILE" "$BASE_URL/api/detail")"
DETAIL_ID="$(node -e "const data=JSON.parse(process.argv[1]); process.stdout.write(data.data?.[0]?.id || '')" "$DETAIL_JSON")"
if [ -z "$DETAIL_ID" ]; then
  fail "detail id missing"
fi

request_code "200" "POST" "/api/swift" "{\"action\":\"direct-create\",\"detailId\":\"$DETAIL_ID\",\"amount\":1200,\"senderName\":\"Sender A\",\"receiverName\":\"Receiver B\"}"
pass "create swift"

request_code "200" "GET" "/api/report?format=excel"
request_code "200" "GET" "/api/report?format=pdf"
pass "export reports"

request_code "200" "POST" "/api/auth" '{"action":"logout"}'
pass "logout"

echo "Isolated API tests completed."
