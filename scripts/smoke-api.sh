#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin@2026!}"
COOKIE_FILE="${COOKIE_FILE:-/tmp/tls_smoke_cookie.txt}"

rm -f "$COOKIE_FILE"

pass() { echo "[PASS] $1"; }
fail() { echo "[FAIL] $1"; exit 1; }

check_code() {
  local name="$1"
  local expected="$2"
  local method="$3"
  local path="$4"
  local data="${5:-}"
  local headers=()
  local body_file
  body_file="$(mktemp)"

  if [ -n "$data" ]; then
    headers+=(-H "Content-Type: application/json")
  fi

  local code
  if [ -n "$data" ]; then
    code=$(curl -sS -o "$body_file" -w "%{http_code}" -b "$COOKIE_FILE" -c "$COOKIE_FILE" -X "$method" "${headers[@]}" --data "$data" "$BASE_URL$path")
  else
    code=$(curl -sS -o "$body_file" -w "%{http_code}" -b "$COOKIE_FILE" -c "$COOKIE_FILE" -X "$method" "$BASE_URL$path")
  fi

  if [ "$code" != "$expected" ]; then
    echo "endpoint=$method $path expected=$expected actual=$code"
    cat "$body_file"
    rm -f "$body_file"
    fail "$name"
  fi

  rm -f "$body_file"
  pass "$name"
}

check_code "system health" "200" "GET" "/api/system/health"
check_code "system routes" "200" "GET" "/api/system/routes"
check_code "config template" "200" "GET" "/api/system/config-template"

check_code "login" "200" "POST" "/api/auth" "{\"action\":\"login\",\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"
check_code "me" "200" "POST" "/api/auth" '{"action":"me"}'
check_code "set locale" "200" "POST" "/api/locale" '{"locale":"zh"}'
check_code "settings get" "200" "GET" "/api/settings"

check_code "invoice list" "200" "GET" "/api/invoice"
check_code "receipt list" "200" "GET" "/api/receipt"
check_code "detail list" "200" "GET" "/api/detail"
check_code "swift list" "200" "GET" "/api/swift"
check_code "deletion list" "200" "GET" "/api/deletion"
check_code "users list" "200" "POST" "/api/auth" '{"action":"list"}'
check_code "report excel" "200" "GET" "/api/report?format=excel"
check_code "report pdf" "200" "GET" "/api/report?format=pdf"
check_code "logout" "200" "POST" "/api/auth" '{"action":"logout"}'

rm -f "$COOKIE_FILE"
echo "Smoke API checks completed."
