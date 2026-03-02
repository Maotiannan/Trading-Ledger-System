#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "[i18n-audit] scanning hardcoded CJK text outside locale message files..."
rg -n "[\p{Han}]" src \
  --glob '!src/messages/**' \
  --glob '!**/*.test.*' \
  --glob '!**/*.spec.*' \
  || true

echo "[i18n-audit] done"
