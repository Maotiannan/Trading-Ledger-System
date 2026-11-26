#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="$ROOT_DIR/.env"
SITE_DIR="$ROOT_DIR/out/site-releases"
PINNED_OVERRIDE=""

log() {
  printf '[rebuild-local-app] %s\n' "$*"
}

refuse() {
  log "PRECHECK REFUSED: $*" >&2
  exit 1
}

check_release_source() {
  local id live source workdir files base="$ROOT_DIR/docker-compose.yml" project="trading-ledger-system"
  id="$(docker ps -aq --filter "label=com.docker.compose.project=$project" --filter label=com.docker.compose.service=app)" ||
    refuse "Cannot inspect the running Compose project."
  [[ -n "$id" && "$id" != *$'\n'* ]] || refuse "Expected one existing MuLedger app; cannot establish the deployed release."
  live="$(docker exec "$id" node -p 'require("/app/package.json").version')" || refuse "Cannot read the live app version."
  source="$(node -p 'require("./package.json").version')" || refuse "Cannot read the source version in $ROOT_DIR."
  log "Preflight: source=$source ($ROOT_DIR); deployed=$live"
  node -e '
    const [src, live] = process.argv.slice(1);
    if (![src, live].every(v => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v))) process.exit(1);
    const delta = src.split(".").map((v, i) => Number(v) - Number(live.split(".")[i])).find(n => n !== 0);
    process.exit(delta < 0 ? 1 : 0);
  ' "$source" "$live" || refuse "Source version is older than the deployed version or cannot be compared. Use the active release record, not this checkout."
  workdir="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$id")" ||
    refuse "Cannot determine the live Compose working directory."
  files="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$id")" ||
    refuse "Cannot determine the live Compose files."
  if [[ "$workdir" = "$ROOT_DIR" && "$files" = "$base,$SITE_DIR/"* ]]; then
    PINNED_OVERRIDE="${files#*,}"
    registered_override "$PINNED_OVERRIDE" || refuse "Unregistered live site override."
    [[ -r "$SITE_DIR/site.env" ]] || refuse "Registered site environment is missing."
    return
  fi
  [[ "$workdir" = "$ROOT_DIR" && "$files" = "$base" ]] ||
    refuse "Production uses another working directory or a release override ($files). Follow its deployment record instead."
  [[ "${COMPOSE_FILE:-$base}" = "$base" && "${COMPOSE_PROJECT_NAME:-$project}" = "$project" ]] ||
    refuse "Compose environment selects a different project or configuration."
  export COMPOSE_FILE="$base" COMPOSE_PROJECT_NAME="$project"
  docker compose config --format json | node -e '
    const cfg = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    if (cfg.name !== process.env.COMPOSE_PROJECT_NAME || cfg.services?.app?.build?.context !== process.cwd()) process.exit(1);
  ' || refuse "Resolved Compose project or app build context does not match this checkout."
}

registered_override() {
  local f="$1" version
  version="$(basename "$(dirname "$f")")"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$f" = "$SITE_DIR/$version/site.override.json" && -f "$f" ]] &&
    [[ "$(node -p 'require("fs").realpathSync(process.argv[1])' "$f")" = "$f" ]]
}

run_pinned() {
  local mode="${1:-}" target="${2:-$PINNED_OVERRIDE}" report key id
  local -a clean=("PATH=$PATH" "HOME=$HOME")
  for key in TMPDIR DOCKER_CONFIG DOCKER_HOST DOCKER_CONTEXT; do
    if printenv "$key" >/dev/null; then clean+=("$key=$(printenv "$key")"); fi
  done
  case "$mode" in
    --check-only|--release|--rollback) ;;
    *) refuse "Site uses a fixed image. Preflight, then supply --release or --rollback and the registered override." ;;
  esac
  registered_override "$target" || refuse "Target must be a registered, immutable site override."
  report="$(node scripts/check-site-compose.mjs "$SITE_DIR/site.env" "$target")" || refuse "Pinned release parity check failed; no change."
  printf '%s\n' "$report"
  node -e '
    const [mode, file, json] = process.argv.slice(1), r = JSON.parse(json);
    const version = require("path").basename(require("path").dirname(file));
    const diff = version.split(".").map((v,i) => Number(v) - Number(r.currentVersion.split(".")[i])).find(Boolean) || 0;
    if (r.candidateVersion !== version || (mode === "--release" &&
       (version !== require("./package.json").version || diff < 0 || (!diff && r.candidateImage !== r.currentImage))) ||
       (mode === "--rollback" && diff >= 0)) process.exit(1);
  ' -- "$mode" "$target" "$report" || refuse "Version/direction does not match the registered target."
  if [[ "$mode" = "--check-only" ]]; then log 'Pinned preflight passed; nothing was changed.'; return; fi
  if [[ "$target" = "$PINNED_OVERRIDE" ]]; then log 'Selected release is already running; no change.'; return; fi
  local -a site=(env -i "${clean[@]}" docker compose --project-directory "$ROOT_DIR" --env-file "$SITE_DIR/site.env" -p trading-ledger-system -f "$ROOT_DIR/docker-compose.yml" -f "$target")
  log 'Switching only app to the verified local image (no migration, dependencies, builds or pulls)'
  "${site[@]}" up -d --no-deps --no-build --pull never app
  id="$("${site[@]}" ps -q app)"
  for _ in $(seq 1 30); do
    if docker exec "$id" node -e 'const http="http://"+require("os").hostname()+":3000"; Promise.all([fetch(http+"/"),fetch(http+"/api/system/health")]).then(([a,b])=>{if(a.status!==200||b.status!==401||require("/app/package.json").version!==process.argv[1])process.exit(1)}).catch(()=>process.exit(1))' "$(basename "$(dirname "$target")")"; then
      node scripts/check-site-compose.mjs "$SITE_DIR/site.env" "$target" >/dev/null || refuse "Post-switch parity failed; consult the previous release record."
      log 'Pinned release verified.'; return
    fi
    sleep 2
  done
  refuse "App switched but readiness/version failed; collect app logs and use the recorded rollback. Other services and data were not changed by this command."
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

case "$#:${1:-}" in
  0:|1:--check-only|2:--release|2:--rollback) ;;
  *) log 'Usage: scripts/rebuild-local-app.sh [--check-only | --release SITE_OVERRIDE | --rollback SITE_OVERRIDE]' >&2; exit 2 ;;
esac
check_release_source
if [[ -n "$PINNED_OVERRIDE" ]]; then run_pinned "$@"; exit 0; fi
if [[ "$#" = 2 ]]; then refuse "Site release flags require an already-adopted, registered site configuration."; fi
if [ "${1:-}" = "--check-only" ]; then log 'Preflight passed; nothing was changed.'; exit 0; fi

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

log 'refreshing email delivery trigger so its token/config matches app'
docker compose up -d --no-deps --force-recreate email-delivery-trigger

log 'waiting for app health endpoint'
log 'refreshing WhatsApp trigger; external sending remains controlled by feature flags'
docker compose up -d --no-deps --force-recreate whatsapp-delivery-trigger

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
