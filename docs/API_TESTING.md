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
