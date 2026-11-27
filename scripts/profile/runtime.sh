#!/usr/bin/env bash
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_ARCH:-} == ARM64 ]] || { echo 'Disposable ARM64 CI host required.' >&2;exit 2; }
id="ledgerprofile-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"; db="$id-db"; app="$id-app"; net="$id-net"
export METRICS_DIR; METRICS_DIR=$(mktemp -d "$RUNNER_TEMP/metrics-XXXX"); chmod 777 "$METRICS_DIR"
docker network create --internal "$net" >/dev/null
cleanup(){ docker rm -f "$app" "$db" >/dev/null 2>&1 || :; docker network rm "$net" >/dev/null; }
trap cleanup EXIT
docker pull mysql:8.4 >/dev/null
docker run -d --name "$db" --network "$net" --network-alias db --memory 1200m --cpus 2 \
  -e MYSQL_ROOT_PASSWORD=profile-root -e MYSQL_USER=ledger_probe -e MYSQL_PASSWORD=profile-only -e MYSQL_DATABASE=trading_ledger_test \
  mysql:8.4 --innodb-buffer-pool-size=134217728 >/dev/null
sql(){ docker exec -e MYSQL_PWD=profile-root -i "$db" mysql -uroot -N -B --unbuffered; }
for _ in $(seq 1 90); do if echo 'SELECT 1'|sql >/dev/null 2>&1;then break;fi;sleep 1;done
echo 'SELECT 1'|sql >/dev/null
export INIT_ADMIN_EMAIL=profile@example.invalid INIT_ADMIN_PASSWORD=ProfileIsolated123! INIT_ADMIN_TOKEN=profile-init-only
export MUCONT_CUSTOMERS_READ_TOKEN=isolated-profile-read-token-1234567890
url="mysql://ledger_probe:profile-only@db:3306/trading_ledger_test${PROFILE_POOL_QUERY:-}"
docker run --rm --network "$net" -e "DATABASE_URL=$url" ledger-profile:run npx --no-install prisma migrate deploy
docker run -d --name "$app" --network "$net" -p 127.0.0.1::3000 --memory 1600m --cpus 2 \
  -e HOSTNAME=0.0.0.0 -e NODE_ENV=production -e NODE_OPTIONS=--require=/probe/prisma-observer.cjs \
  -e "DATABASE_URL=$url" -e ENABLE_INIT_ROUTE=true -e INIT_ADMIN_EMAIL -e INIT_ADMIN_PASSWORD -e INIT_ADMIN_TOKEN \
  -e SESSION_SECRET=isolated-profile-session-secret-0123456789 -e MUCONT_CUSTOMERS_READ_TOKEN -e UPLOAD_DIR=/tmp/isolated-uploads \
  -e RESEND_API_KEY= -e WHATSAPP_OUTBOUND_ENABLED=false -e OCR_DISABLED=true \
  --mount "type=bind,src=$PWD/scripts/profile,dst=/probe,readonly" --mount "type=bind,src=$METRICS_DIR,dst=/metrics" \
  ledger-profile:run node server.js >/dev/null
export BASE_URL; BASE_URL="http://$(docker port "$app" 3000/tcp|head -1)"
ready=0; for _ in $(seq 1 60); do if curl -fsS -o /dev/null "$BASE_URL"; then ready=1; break; fi;sleep 1;done
if [[ $ready != 1 ]]; then docker logs "$app" --tail 35; exit 1; fi
# One separate observer connection. Count only the authenticated application user.
awk 'BEGIN{for(i=0;i<3600;i++)print "SELECT UNIX_TIMESTAMP(NOW(3)),COUNT(*),COALESCE(SUM(PROCESSLIST_COMMAND!=\047Sleep\047),0) FROM performance_schema.threads WHERE PROCESSLIST_USER=\047ledger_probe\047; DO SLEEP(0.2);"}' > "$METRICS_DIR/sample.sql"
sql < "$METRICS_DIR/sample.sql" > "$METRICS_DIR/connections.tsv" 2>/dev/null & sampler=$!
rc=0; node scripts/profile/queries.mjs || rc=$?
if [[ $rc != 0 ]];then docker logs "$app" --tail 45;exit "$rc";fi
sleep 20; printf 'PROFILE_COOLED ';cat "$METRICS_DIR/current";echo
awk 'NF==3{if($2>m)m=$2;if($3>a)a=$3;n++;last=$2}END{printf "PROFILE_MYSQL samples=%d maxConnections=%d maxActive=%d final=%d\n",n,m,a,last; if(n<2 || m<1)exit 1}' "$METRICS_DIR/connections.tsv"
kill "$sampler" 2>/dev/null || :
docker run --rm --network none --entrypoint sh ledger-profile:run -c 'du -sk /app /app/node_modules /app/.next; ls -d /app/node_modules/{prisma,.prisma} 2>/dev/null || true'
