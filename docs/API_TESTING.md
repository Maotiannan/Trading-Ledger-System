# API Testing Guide

This project is fully API-driven. UI features map to API endpoints under `/api/*`.

## 1. System endpoints (for testing bootstrap)

- `GET /api/system/health` (requires login)
- `GET /api/system/routes` (admin only)
- `GET /api/system/config-template` (admin only)
- `GET /api/settings`

Use these first to verify runtime status and config placeholders.

## 2. Fill required settings

Copy `.env.example` and fill:

- `DATABASE_URL`
- `SESSION_SECRET`
- Optional OCR settings:
  - `OCR_DISABLED`
  - `OCR_API_BASE_URL`
  - `OCR_API_KEY`
  - `OCR_MODEL`

## 2.1 Dashboard customer history search

All logged-in roles can call this endpoint. Results are restricted to the current account's existing customer, order, and receipt visibility scope.

```bash
# Search starts only when this request is sent.
curl -b cookie.txt \
  "http://127.0.0.1/api/dashboard/customer-history-search?action=search&query=PIKIN"

# Open the selected customer's combined ORDER_NAME history.
curl -b cookie.txt \
  "http://127.0.0.1/api/dashboard/customer-history-search?action=history&customerId=CUSTOMER_ID&orderPage=1&receiptPage=1"
```

`MARK / ORDER_NAME / ORDER NO` use exact normalized matching. `NAME` supports case-insensitive contains matching. The history action returns all visible ORDER_NAME groups for the selected customer while keeping Historical Orders and Recent Receipts independently paginated.

## 2.2 Orders confirmed date

`confirmedAt` is read-only API output. Clients submit only `status`; the server maintains the timestamp atomically:

- non-`Confirmed` to `Confirmed`: set current server time;
- `Confirmed` to another status: clear it;
- no status transition or unrelated edit: preserve it.

```bash
curl -b cookie.txt -X POST http://127.0.0.1/api/orders \
  -H "Content-Type: application/json" \
  --data '{"action":"update","orderId":"ORDER_TRACKER_ID","status":"Confirmed"}'

curl -b cookie.txt "http://127.0.0.1/api/orders?search=ORDER-001"
```

The list response returns `confirmedAt` as an ISO timestamp or `null`. The Orders page formats it as `DD/MM/YYYY` in `Africa/Conakry`.

## 2.3 Dashboard customer analytics

All logged-in roles can read customer analytics. Ranking and detail results use the same management-tree visibility rules as the underlying customers, finance orders, and receipts. A detail request for a customer outside the current account scope returns `404`.

```bash
# Released invoice amount in one natural year.
curl -b cookie.txt \
  "http://127.0.0.1/api/dashboard/customer-analytics?action=ranking&metric=annual-amount&year=2026"

# Omitting year uses the current natural year from the server's Africa/Conakry clock.
curl -b cookie.txt \
  "http://127.0.0.1/api/dashboard/customer-analytics?action=ranking&metric=annual-amount"

# Average receipts across the configured trailing completed months.
curl -b cookie.txt \
  "http://127.0.0.1/api/dashboard/customer-analytics?action=ranking&metric=payment-capacity"

# Amount-weighted payment-cycle ranking.
curl -b cookie.txt \
  "http://127.0.0.1/api/dashboard/customer-analytics?action=ranking&metric=payment-cycle"

# Evidence for one ranking row. Reuse the ranking response's asOf value so both calculations share one cutoff.
curl -b cookie.txt \
  "http://127.0.0.1/api/dashboard/customer-analytics?action=detail&metric=annual-amount&customerId=CUSTOMER_ID&year=2026&asOf=2026-07-15T12%3A00%3A00.000Z"
curl -b cookie.txt \
  "http://127.0.0.1/api/dashboard/customer-analytics?action=detail&metric=payment-capacity&customerId=CUSTOMER_ID&asOf=2026-07-15T12%3A00%3A00.000Z"
curl -b cookie.txt \
  "http://127.0.0.1/api/dashboard/customer-analytics?action=detail&metric=payment-cycle&customerId=CUSTOMER_ID&asOf=2026-07-15T12%3A00%3A00.000Z"
```

The API calculates results at request time on the server. Annual amount uses invoice `releaseDate`, not ship date. Payment capacity uses the previous completed Conakry calendar months and includes zero-payment months. Receipt calculations include every formal status except `SIGNING_PENDING`, prefer the receipt business date, fall back to creation time when missing, and ignore future-dated receipts. Ranking rows and detail evidence use the same backend calculator. Detail `asOf` is optional, must use the canonical UTC format emitted by ranking (`YYYY-MM-DDTHH:mm:ss.sssZ`), and should be copied unchanged from the ranking response to keep the evidence on the same calculation cutoff.

Only ADMIN accounts can change the shared analytics settings. If a request changes any analytics rule, it must submit all seven analytics keys together. The server validates and saves the complete set transactionally, rejecting missing, reversed, or invalid values without saving any field. Unrelated settings remain writable even if legacy analytics rows are malformed:

```bash
curl -b cookie.txt -X POST http://127.0.0.1/api/settings \
  -H "Content-Type: application/json" \
  --data '{
    "action":"update-config",
    "settings":{
      "CUSTOMER_ANALYTICS_LOOKBACK_MONTHS":"12",
      "CUSTOMER_ANALYTICS_NORMAL_DAYS":"30",
      "CUSTOMER_ANALYTICS_MILD_DELAY_DAYS":"60",
      "CUSTOMER_ANALYTICS_DELAY_DAYS":"90",
      "CUSTOMER_ANALYTICS_WARNING_DAYS":"120",
      "CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS":"150",
      "CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS":"180"
    }
  }'
```

Automated isolated regression:

```bash
npm run test:api:isolated -- --case 36-dashboard-customer-analytics
```

This case verifies USER/ADMIN visibility, all three rankings and details, zero-payment customers, receipt de-duplication, settings authorization, and transactional threshold validation against a temporary MariaDB instance.

## 3. Common test flow (curl)

```bash
# login
curl -i -c cookie.txt -X POST http://127.0.0.1/api/auth \
  -H "Content-Type: application/json" \
  --data '{"action":"login","email":"admin@example.com","password":"YOUR_PASSWORD"}'

# health (after login)
curl -b cookie.txt -s http://127.0.0.1/api/system/health | jq

# me
curl -b cookie.txt -X POST http://127.0.0.1/api/auth \
  -H "Content-Type: application/json" \
  --data '{"action":"me"}'

# invoice list
curl -b cookie.txt http://127.0.0.1/api/invoice

# direct create receipt (no OCR)
curl -b cookie.txt -X POST http://127.0.0.1/api/receipt \
  -H "Content-Type: application/json" \
  --data '{"action":"direct-create","usd":100,"orderNo":"ORDER-001","isDeposit":false}'

# receipt list
curl -b cookie.txt http://127.0.0.1/api/receipt

# detail list
curl -b cookie.txt http://127.0.0.1/api/detail

# swift list
curl -b cookie.txt http://127.0.0.1/api/swift

# deletion list
curl -b cookie.txt http://127.0.0.1/api/deletion

# admin-only routes catalog
curl -b cookie.txt -s http://127.0.0.1/api/system/routes | jq

# admin-only config template
curl -b cookie.txt -s http://127.0.0.1/api/system/config-template | jq

# logout
curl -b cookie.txt -X POST http://127.0.0.1/api/auth \
  -H "Content-Type: application/json" \
  --data '{"action":"logout"}'
```

## 4. Action discovery

For exact supported actions and body examples, call:

```bash
curl -b cookie.txt -s http://127.0.0.1/api/system/routes | jq
```

## 5. Excel ML token API

Generate a token after login:

```bash
curl -b cookie.txt -X POST http://127.0.0.1/api/excel/token \
  -H "Content-Type: application/json" \
  --data '{"action":"generate","name":"Excel ML"}' | jq
```

Lookup a single field with bearer auth:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://127.0.0.1/api/excel/ml?orderNo=GANDO-10&field=2"
```

Use `format=json` for diagnostics and `POST /api/excel/ml/batch` for multiple rows.

Automated isolated API regression:

```bash
npm run test:api:isolated -- --case 90-excel-ml-token
```

This verifies token generation, fields `1/2/3`, JSON diagnostics, batch row errors, and revoke rejection.
