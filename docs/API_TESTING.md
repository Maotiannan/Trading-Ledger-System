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
