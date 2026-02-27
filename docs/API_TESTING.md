# API Testing Guide

This project is fully API-driven. UI features map to API endpoints under `/api/*`.

## 1. System endpoints (for testing bootstrap)

- `GET /api/system/health`
- `GET /api/system/routes`
- `GET /api/system/config-template`

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
# health
curl -s http://127.0.0.1/api/system/health | jq

# login
curl -i -c cookie.txt -X POST http://127.0.0.1/api/auth \
  -H "Content-Type: application/json" \
  --data '{"action":"login","email":"admin@example.com","password":"YOUR_PASSWORD"}'

# me
curl -b cookie.txt -X POST http://127.0.0.1/api/auth \
  -H "Content-Type: application/json" \
  --data '{"action":"me"}'

# invoice list
curl -b cookie.txt http://127.0.0.1/api/invoice

# receipt list
curl -b cookie.txt http://127.0.0.1/api/receipt

# detail list
curl -b cookie.txt http://127.0.0.1/api/detail

# swift list
curl -b cookie.txt http://127.0.0.1/api/swift

# deletion list
curl -b cookie.txt http://127.0.0.1/api/deletion

# logout
curl -b cookie.txt -X POST http://127.0.0.1/api/auth \
  -H "Content-Type: application/json" \
  --data '{"action":"logout"}'
```

## 4. Action discovery

For exact supported actions and body examples, call:

```bash
curl -s http://127.0.0.1/api/system/routes | jq
```
