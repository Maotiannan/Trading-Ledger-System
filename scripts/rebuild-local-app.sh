#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="$ROOT_DIR/.env"

log() {
  printf '[rebuild-local-app] %s\n' "$*"
}

random_secret() {
  openssl rand -hex 32
}

get_env_value() {
  local key="$1"
  if [ ! -f "$ENV_FILE" ]; then
    return 0
  fi
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

is_unsafe_secret() {
  local value="${1:-}"
  local normalized
  normalized="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]' | xargs)"
  if [ -z "$normalized" ]; then
    return 0
  fi
  if [ "${#normalized}" -lt 32 ]; then
    return 0
  fi
  case "$normalized" in
    replace-with-a-long-random-secret|replace-with-your-secret|replace-secret|changeme|change-me|dev-only-session-secret-change-me-32-chars)
      return 0
      ;;
  esac
  return 1
}

set_env_value() {
  local key="$1"
  local value="$2"
  touch "$ENV_FILE"
  if grep -q "^${key}=" "$ENV_FILE"; then
    KEY="$key" VALUE="$value" perl -0pi -e 's/^\Q$ENV{KEY}\E=.*/$ENV{KEY} . "=" . $ENV{VALUE}/me' "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

ensure_secret() {
  local key="$1"
  local current
  current="$(get_env_value "$key")"
  if is_unsafe_secret "$current"; then
    set_env_value "$key" "$(random_secret)"
    log "$key was missing or unsafe; generated a local value in .env"
  else
    log "$key exists"
  fi
}

ensure_env_defaults() {
  ensure_secret SESSION_SECRET
  ensure_secret MAINTENANCE_JOB_TOKEN
  if ! grep -q '^TRUST_PROXY_HEADERS=' "$ENV_FILE" 2>/dev/null; then
    set_env_value TRUST_PROXY_HEADERS true
    log 'TRUST_PROXY_HEADERS was missing; set to true for Caddy reverse proxy'
  fi
}

wait_for_app() {
  local attempt
  for attempt in $(seq 1 60); do
    if docker compose exec -T app node -e "const os=require('node:os'); fetch('http://' + os.hostname() + ':3000/api/system/health').then((r)=>{ if (![200,401].includes(r.status)) process.exit(1); console.log('app health http status', r.status); }).catch(()=>process.exit(1));"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

log 'checking local environment'
ensure_env_defaults

log 'validating docker compose config'
docker compose config --quiet

log 'current containers'
docker compose ps

log 'rebuilding app service only; database and volumes are untouched'
docker compose up -d --no-deps --build app

log 'refreshing maintenance service so its token/config matches app'
docker compose up -d --no-deps --force-recreate maintenance

log 'refreshing MU Contract trigger so its token/config matches app'
docker compose up -d --no-deps --force-recreate mucontract-sync-trigger

log 'waiting for app health endpoint'
if ! wait_for_app; then
  log 'app health check failed; recent app logs follow'
  docker compose logs --no-color --tail=120 app || true
  exit 1
fi

log 'checking maintenance endpoint with container token'
docker compose exec -T maintenance sh -c 'curl -fsS -X POST "$MAINTENANCE_BASE_URL/api/internal/maintenance/uploaded-assets" -H "x-maintenance-token: $MAINTENANCE_JOB_TOKEN" >/dev/null'

log 'checking MU Contract pull endpoint with container token'
docker compose exec -T mucontract-sync-trigger sh -c 'curl -fsS -X POST "$MAINTENANCE_BASE_URL/api/internal/integrations/mu-contract/pull" -H "x-maintenance-token: $MAINTENANCE_JOB_TOKEN" >/dev/null'

log 'final containers'
docker compose ps

log 'rebuild completed successfully'
