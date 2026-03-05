#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-12345678}"
COOKIE_FILE="${COOKIE_FILE:-/tmp/tls_customer_scope_cookie.txt}"

rm -f "$COOKIE_FILE"

HTTP_CODE=""
HTTP_BODY=""

pass() { echo "[PASS] $1"; }
fail() { echo "[FAIL] $1"; exit 1; }

parse_json() {
  local json="$1"
  local expr="$2"
  node -e "const d=JSON.parse(process.argv[1]); const v=(function(){return ${expr}})(); if(v===undefined||v===null){process.exit(2)}; console.log(typeof v==='object'?JSON.stringify(v):String(v));" "$json"
}

request_json() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local tmp
  tmp="$(mktemp)"
  if [ -n "$data" ]; then
    HTTP_CODE=$(curl -sS -o "$tmp" -w "%{http_code}" -b "$COOKIE_FILE" -c "$COOKIE_FILE" -X "$method" -H "Content-Type: application/json" --data "$data" "$BASE_URL$path")
  else
    HTTP_CODE=$(curl -sS -o "$tmp" -w "%{http_code}" -b "$COOKIE_FILE" -c "$COOKIE_FILE" -X "$method" "$BASE_URL$path")
  fi
  HTTP_BODY="$(cat "$tmp")"
  rm -f "$tmp"
}

# Login admin
request_json "POST" "/api/auth" "{\"action\":\"login\",\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"
[ "$HTTP_CODE" = "200" ] || fail "admin login"
admin_id="$(parse_json "$HTTP_BODY" 'd.data.id')"
pass "admin login"

suffix="$(date +%s)-$RANDOM"
phone_tail="$(printf '%05d' $((RANDOM % 100000)))"
sales_email="qa-sales-${suffix}@example.com"

# Create sales user
request_json "POST" "/api/auth" "{\"action\":\"create\",\"email\":\"$sales_email\",\"password\":\"12345678\",\"role\":\"SALES\",\"name\":\"QA Sales $suffix\"}"
[ "$HTTP_CODE" = "200" ] || fail "create sales"
sales_id="$(parse_json "$HTTP_BODY" 'd.data.id')"
pass "create sales"

# Same name allowed in same pool (owner=admin)
for idx in 1 2; do
  order="QA-ORD-${suffix}-${idx}"
  phone="620${phone_tail}${idx}"
  payload="{\"action\":\"create\",\"mark\":\"QA-MARK\",\"orderName\":\"$order\",\"name\":\"Ibrahima Diallo\",\"phone\":\"$phone\",\"city\":\"Conakry\",\"consignee\":\"\",\"companyName\":\"QA-COMP-${suffix}-${idx}\",\"credit\":0}"
  request_json "POST" "/api/customer" "$payload"
  [ "$HTTP_CODE" = "200" ] || fail "same-name create #$idx"
done
pass "same-name allowed"

# Duplicate ORDER_NAME in same pool should fail
payload_dup_order="{\"action\":\"create\",\"mark\":\"QA-MARK\",\"orderName\":\"QA-ORD-${suffix}-1\",\"name\":\"Dup Order\",\"phone\":\"631${phone_tail}9\",\"city\":\"Conakry\",\"companyName\":\"QA-COMP-${suffix}-X\",\"credit\":0}"
request_json "POST" "/api/customer" "$payload_dup_order"
[ "$HTTP_CODE" = "400" ] || fail "duplicate ORDER_NAME rejected"
pass "duplicate ORDER_NAME rejected"

# Same ORDER_NAME in different pool should pass (owner=sales)
payload_cross_scope="{\"action\":\"create\",\"ownerId\":\"$sales_id\",\"mark\":\"QA-MARK\",\"orderName\":\"QA-ORD-${suffix}-1\",\"name\":\"Cross Scope\",\"phone\":\"639${phone_tail}8\",\"city\":\"Conakry\",\"companyName\":\"QA-COMP-${suffix}-Y\",\"credit\":0}"
request_json "POST" "/api/customer" "$payload_cross_scope"
[ "$HTTP_CODE" = "200" ] || fail "cross-scope duplicate allowed"
pass "cross-scope duplicate allowed"

# Build import xlsx (update same customer by ORDER_NAME/PHONE in admin pool)
import_xlsx="/tmp/customer_scope_import_${suffix}.xlsx"
node - <<'NODE' "$import_xlsx" "$suffix" "$phone_tail"
const ExcelJS = require('exceljs');
const out = process.argv[2];
const suffix = process.argv[3];
const phoneTail = process.argv[4];
(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('customer_import');
  ws.addRow(['MARK','ORDER_NAME','NAME','PHONE','CITY','CONSIGNEE','COMPANY_NAME','CREDIT','COMPANY_ADDRESS']);
  ws.addRow(['QA-MARK',`QA-ORD-${suffix}-1`,'Ibrahima Diallo Updated',`620${phoneTail}1`,'Conakry','',`QA-COMP-${suffix}-1`,0,'']);
  await wb.xlsx.writeFile(out);
})();
NODE

HTTP_CODE=$(curl -sS -o /tmp/customer_scope_import_resp.json -w "%{http_code}" -b "$COOKIE_FILE" -c "$COOKIE_FILE" -X POST \
  -F "action=import-excel" \
  -F "ownerId=$admin_id" \
  -F "file=@${import_xlsx}" \
  "$BASE_URL/api/customer")
HTTP_BODY="$(cat /tmp/customer_scope_import_resp.json)"
rm -f /tmp/customer_scope_import_resp.json "$import_xlsx"
[ "$HTTP_CODE" = "200" ] || fail "import with upsert"
updated_count="$(parse_json "$HTTP_BODY" 'd.data.updatedCount')"
[ "$updated_count" -ge 1 ] || fail "import should update existing"
pass "import upsert"

# Sales visibility: only own owner pool
request_json "POST" "/api/auth" "{\"action\":\"logout\"}"
[ "$HTTP_CODE" = "200" ] || fail "admin logout"

request_json "POST" "/api/auth" "{\"action\":\"login\",\"email\":\"$sales_email\",\"password\":\"12345678\"}"
[ "$HTTP_CODE" = "200" ] || fail "sales login"

request_json "GET" "/api/customer?search=QA-ORD-${suffix}-1"
[ "$HTTP_CODE" = "200" ] || fail "sales customer list"
count="$(parse_json "$HTTP_BODY" 'Array.isArray(d.data) ? d.data.length : 0')"
[ "$count" -ge 1 ] || fail "sales should see bound pool"

# should not see admin-owned QA-ORD-...-2
request_json "GET" "/api/customer?search=QA-ORD-${suffix}-2"
[ "$HTTP_CODE" = "200" ] || fail "sales customer list 2"
count="$(parse_json "$HTTP_BODY" 'Array.isArray(d.data) ? d.data.length : 0')"
[ "$count" = "0" ] || fail "sales should not see other pool"
pass "sales visibility scope"

rm -f "$COOKIE_FILE"
echo "Customer scope API checks completed."
