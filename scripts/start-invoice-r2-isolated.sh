#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export DATABASE_URL='mysql://root:invoice-r2-isolated-only@127.0.0.1:3313/muledger_invoice_r2_test'
export SESSION_SECRET='invoice-r2-isolated-session-12345678901234567890'
export MUCONT_INVOICE_RECEIVE_TOKEN='invoice-r2-receive-isolated-12345678901234567890'
export MUCONT_INVOICE_READ_TOKEN='invoice-r2-read-isolated-12345678901234567890'
export MUCONT_INVOICE_ACTOR_ID='invoice-r2-admin'
export MUCONT_INVOICE_BASE_URL="${MUCONT_INVOICE_BASE_URL:-http://127.0.0.1:3314}"
case "$MUCONT_INVOICE_BASE_URL" in
  http://127.0.0.1:3314|http://127.0.0.1:3321) ;;
  *) echo 'Refusing a non-isolated invoice source URL' >&2; exit 1 ;;
esac
export NEXT_DIST_DIR='.next-invoice-r2'
export UPLOAD_DIR="$PWD/out/invoice-r2-isolated/uploads"
export WHATSAPP_OUTBOUND_ENABLED=false
export WHATSAPP_WEBHOOK_ENABLED=false
export YCLOUD_API_KEY=''
export RESEND_API_KEY=''
export OCR_DISABLED=true
mkdir -p "$UPLOAD_DIR"
npx next dev --webpack -H 127.0.0.1 -p 3312
