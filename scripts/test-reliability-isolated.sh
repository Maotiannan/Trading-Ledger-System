#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/muledger-reliability-backup-XXXXXX")"
CONTAINER="muledger-reliability-${$}"
MYSQL_CONTAINER="muledger-reliability-mysql-${$}"
PASSWORD="reliability-test-only"
STAGE="start isolated MariaDB"
cleanup() {
  code=$?
  if [ "$code" -ne 0 ]; then
    echo "[FAIL] stage=$STAGE exit=$code; isolated evidence=$WORK" >&2
    docker logs --tail 100 "$CONTAINER" > "$WORK/database.log" 2>&1 || true
    docker logs --tail 100 "$MYSQL_CONTAINER" > "$WORK/mysql-database.log" 2>&1 || true
    for log in "$WORK"/*.log; do
      [ -f "$log" ] || continue
      printf '\n--- %s ---\n' "$log" >&2
      tail -40 "$log" >&2
    done
  fi
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker rm -f "$MYSQL_CONTAINER" >/dev/null 2>&1 || true
  echo "Evidence retained at $WORK (synthetic test data only)."
}
trap cleanup EXIT

# No Compose project, shared network, host directory, production volume or NAS mount.
docker run -d --name "$CONTAINER" --label task=muledger-reliability-isolated \
  --tmpfs /var/lib/mysql:rw,size=768m -p 127.0.0.1::3306 \
  -e MARIADB_ROOT_PASSWORD="$PASSWORD" -e MARIADB_DATABASE=muledger_reliability_test \
  mariadb:11 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci > "$WORK/container-id"
ready=false
for _ in $(seq 1 60); do
  if docker exec -e MYSQL_PWD="$PASSWORD" "$CONTAINER" mariadb -uroot muledger_reliability_test -e 'SELECT 1' >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[ "$ready" = true ] || { echo 'Isolated MariaDB did not become ready' >&2; exit 1; }
PORT="$(docker port "$CONTAINER" 3306/tcp | sed 's/^127\.0\.0\.1://')"
export DATABASE_URL="mysql://root:$PASSWORD@127.0.0.1:$PORT/muledger_reliability_test"
export MULEDGER_RELIABILITY_ISOLATED=true
export SESSION_SECRET=reliability-test-session-secret-only-1234567890
export OCR_DISABLED=true OCR_API_KEY='' YCLOUD_API_KEY='' RESEND_API_KEY=''
export WHATSAPP_OUTBOUND_ENABLED=false WHATSAPP_WEBHOOK_ENABLED=false EMAIL_OUTBOUND_ENABLED=false
export MU_CONTRACT_SYNC_BASE_URL='' MU_CONTRACT_SYNC_TOKEN=''
export MULEDGER_RELIABILITY_BACKUP_DIR="$WORK"

STAGE="full historical migrations"
npx prisma migrate deploy > "$WORK/migrate.log" 2>&1
STAGE="accounts and recovery regressions"
npx jest --config jest.reliability.config.mjs --runInBand --runTestsByPath \
  tests/reliability/accounts.integration.ts tests/reliability/recovery.integration.ts > "$WORK/tests.log" 2>&1
STAGE="create synthetic backup fixtures"
MULEDGER_RELIABILITY_BACKUP_PHASE=seed npx jest --config jest.reliability.config.mjs --runInBand \
  --runTestsByPath tests/reliability/backup-roundtrip.integration.ts > "$WORK/seed.log" 2>&1
STAGE="database and media snapshot"
docker exec -e MYSQL_PWD="$PASSWORD" "$CONTAINER" mariadb-dump -uroot --single-transaction --routines --triggers muledger_reliability_test > "$WORK/database.sql"
tar -cf "$WORK/media.tar" -C "$WORK/media" .
STAGE="restore into independent empty database and directory"
docker exec -e MYSQL_PWD="$PASSWORD" "$CONTAINER" mariadb -uroot -e 'CREATE DATABASE muledger_reliability_restore_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
docker exec -i -e MYSQL_PWD="$PASSWORD" "$CONTAINER" mariadb -uroot muledger_reliability_restore_test < "$WORK/database.sql"
mkdir "$WORK/restored-media"
tar -xf "$WORK/media.tar" -C "$WORK/restored-media"
STAGE="verify restored identities, media hash, deadlines and idempotent recovery"
DATABASE_URL="mysql://root:$PASSWORD@127.0.0.1:$PORT/muledger_reliability_restore_test" \
  MULEDGER_RELIABILITY_BACKUP_PHASE=restore npx jest --config jest.reliability.config.mjs --runInBand \
  --runTestsByPath tests/reliability/backup-roundtrip.integration.ts > "$WORK/restore.log" 2>&1
echo '[PASS] full MariaDB migration chain, account/recovery tests and database/media restore roundtrip'
tail -7 "$WORK/tests.log"
tail -7 "$WORK/restore.log"

# The concurrency tests use MySQL's actual data_lock_waits instrumentation.
# Legacy MariaDB TEXT defaults predate this change; do not rewrite old migrations.
STAGE="start isolated MySQL for financial concurrency"
docker run -d --name "$MYSQL_CONTAINER" --label task=muledger-reliability-isolated \
  --tmpfs /var/lib/mysql:rw,size=768m -p 127.0.0.1::3306 \
  -e MYSQL_ROOT_PASSWORD="$PASSWORD" -e MYSQL_DATABASE=muledger_reliability_test \
  mysql:8.4 > "$WORK/mysql-container-id"
ready=false
for _ in $(seq 1 90); do
  if docker exec -e MYSQL_PWD="$PASSWORD" "$MYSQL_CONTAINER" mysql -uroot muledger_reliability_test -e 'SELECT 1' >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[ "$ready" = true ] || { echo 'Isolated MySQL did not become ready' >&2; exit 1; }
PORT="$(docker port "$MYSQL_CONTAINER" 3306/tcp | sed 's/^127\.0\.0\.1://')"
export DATABASE_URL="mysql://root:$PASSWORD@127.0.0.1:$PORT/muledger_reliability_test"
STAGE="create isolated MySQL test schema"
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > "$WORK/mysql-schema.sql" 2> "$WORK/mysql-schema.log"
node scripts/profile/mysql-test-schema.mjs < "$WORK/mysql-schema.sql" |
  docker exec -i -e MYSQL_PWD="$PASSWORD" "$MYSQL_CONTAINER" mysql -uroot muledger_reliability_test >> "$WORK/mysql-schema.log" 2>&1
STAGE="real MySQL financial concurrency"
npx jest --config jest.reliability.config.mjs --runInBand --runTestsByPath \
  tests/reliability/financial.integration.ts tests/reliability/approval.integration.ts > "$WORK/financial.log" 2>&1
tail -7 "$WORK/financial.log"
echo '[PASS] isolated MySQL financial concurrency; no production databases, volumes or NAS mounts used'
