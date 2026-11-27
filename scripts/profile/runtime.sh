#!/usr/bin/env bash
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_ARCH:-} == ARM64 ]] || { echo 'Disposable ARM64 CI host required.' >&2;exit 2; }
image=${PROFILE_IMAGE:-ledger-profile:run}
[[ $image == ledger-profile:run || $image == ledger-profile:baseline || $image == ledger-profile:candidate ]]
id="ledgerprofile-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"; db="$id-db"; app="$id-app"; net="$id-net"; stub="$id-stub"; generic="$id-generic"; migration_db="$id-migration"
echo "PROFILE_IMAGE tag=$image id=$(docker inspect -f '{{.Id}}' "$image")"
export METRICS_DIR; METRICS_DIR=$(mktemp -d "$RUNNER_TEMP/metrics-XXXX"); chmod 777 "$METRICS_DIR"
docker network create --internal "$net" >/dev/null
cleanup(){ if [[ -n ${relay:-} ]]; then kill "$relay" 2>/dev/null || :; fi; docker rm -fv "$app" "$generic" "$stub" "$db" "$migration_db" >/dev/null 2>&1 || :; docker network rm "$net" >/dev/null; }
trap cleanup EXIT
docker pull mysql:8.4 >/dev/null
docker run -d --name "$db" --network "$net" --network-alias db --memory 1200m --cpus 2 \
  -e MYSQL_ROOT_PASSWORD=profile-root -e MYSQL_USER=ledger_probe -e MYSQL_PASSWORD=profile-only -e MYSQL_DATABASE=trading_ledger_test \
  mysql:8.4 --innodb-buffer-pool-size=134217728 >/dev/null
sql(){ docker exec -e MYSQL_PWD=profile-root -i "$db" mysql --protocol=TCP -h127.0.0.1 -uroot trading_ledger_test -N -B --unbuffered; }
for _ in $(seq 1 90); do if echo 'SELECT 1'|sql >/dev/null 2>&1;then break;fi;sleep 1;done
echo 'SELECT 1'|sql >/dev/null
export INIT_ADMIN_EMAIL=profile@example.invalid INIT_ADMIN_PASSWORD=ProfileIsolated123! INIT_ADMIN_TOKEN=profile-init-only
export MUCONT_CUSTOMERS_READ_TOKEN=isolated-profile-read-token-1234567890
url="mysql://ledger_probe:profile-only@db:3306/trading_ledger_test${PROFILE_POOL_QUERY:-}"
docker run --rm --network "$net" -e "DATABASE_URL=$url" "$image" npx --no-install prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script |
  node scripts/profile/mysql-test-schema.mjs | docker exec -i -e MYSQL_PWD=profile-root "$db" mysql -uroot trading_ledger_test
echo 'PROFILE_SCHEMA engine=MySQL-8.4 method=schema-diff not-a-migration-test'
docker run -d --name "$migration_db" --network "$net" --network-alias migration --memory 800m \
  -e MARIADB_ROOT_PASSWORD=profile-root -e MARIADB_DATABASE=trading_ledger_test mariadb:11 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci >/dev/null
maria(){ docker exec -i -e MYSQL_PWD=profile-root "$migration_db" mariadb --protocol=TCP -h127.0.0.1 -uroot trading_ledger_test -N -B; }
for _ in $(seq 1 90); do if echo 'SELECT 1'|maria >/dev/null 2>&1;then break;fi;sleep 1;done
echo 'SELECT 1'|maria >/dev/null
docker run -d --name "$generic" --network "$net" --memory 1g -e HOSTNAME=0.0.0.0 -e DATABASE_URL=mysql://root:profile-root@migration:3306/trading_ledger_test "$image" >/dev/null
expected=$(find prisma/migrations -mindepth 1 -maxdepth 1 -type d | wc -l)
for _ in $(seq 1 90); do
  if docker exec "$generic" node -e 'fetch("http://127.0.0.1:3000/").then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))' 2>/dev/null; then break; fi
  [[ $(docker inspect -f '{{.State.Running}}' "$generic") == true ]] || { docker logs "$generic" --tail 25; exit 1; }
  sleep 1
done
migrated=$(echo 'SELECT COUNT(*) FROM trading_ledger_test._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL' | maria)
[[ $migrated -eq $expected ]] || { docker logs "$generic" --tail 20; exit 1; }
docker exec "$generic" node -e 'fetch("http://127.0.0.1:3000/").then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))'
docker exec "$generic" npx --no-install prisma migrate status >/dev/null
echo "PROFILE_MIGRATION engine=MariaDB-11 applied=$migrated defaultCommandReady=true"
docker rm -fv "$generic" "$migration_db" >/dev/null
docker run -d --name "$stub" --network "$net" --network-alias ocr --memory 96m \
  --mount "type=bind,src=$PWD/scripts/profile/ocr-stub.mjs,dst=/stub.mjs,readonly" --mount "type=bind,src=$METRICS_DIR,dst=/metrics" "$image" node /stub.mjs >/dev/null
docker run -d --name "$app" --network "$net" --memory 1600m --cpus 2 \
  -e HOSTNAME=0.0.0.0 -e NODE_ENV=production -e NODE_OPTIONS=--require=/probe/prisma-observer.cjs \
  -e "DATABASE_URL=$url" -e ENABLE_INIT_ROUTE=true -e INIT_ADMIN_EMAIL -e INIT_ADMIN_PASSWORD -e INIT_ADMIN_TOKEN \
  -e SESSION_SECRET=isolated-profile-session-secret-0123456789 -e MUCONT_CUSTOMERS_READ_TOKEN -e UPLOAD_DIR=/tmp/isolated-uploads \
  -e RESEND_API_KEY= -e WHATSAPP_OUTBOUND_ENABLED=false -e OCR_DISABLED=false \
  -e OCR_API_KEY=fixture-only -e OCR_API_BASE_URL=http://ocr:8080/v1 -e OCR_MAX_RETRIES=1 \
  --mount "type=bind,src=$PWD/scripts/profile,dst=/probe,readonly" --mount "type=bind,src=$METRICS_DIR,dst=/metrics" \
  "$image" node server.js >/dev/null
# Docker does not publish ports on an internal bridge. Only the runner host needs an HTTP origin.
address=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$app")
node --input-type=module - "$address" > "$METRICS_DIR/port" <<'JS' &
import net from 'node:net';
const server=net.createServer(client=>{
  const target=net.connect(3000,process.argv[2]);
  client.on('error',()=>target.destroy()); target.on('error',()=>client.destroy());
  client.pipe(target).pipe(client);
});
server.listen(0,'127.0.0.1',()=>console.log(server.address().port));
JS
relay=$!
for _ in {1..30}; do [[ ! -s "$METRICS_DIR/port" ]] || break; sleep .1; done
export BASE_URL="http://127.0.0.1:$(cat "$METRICS_DIR/port")"
ready=0; for _ in $(seq 1 60); do if curl -fsS -o /dev/null "$BASE_URL"; then ready=1; break; fi;sleep 1;done
if [[ $ready != 1 ]]; then docker logs "$app" --tail 35; exit 1; fi
# One separate observer connection. Count only the authenticated application user.
awk 'BEGIN{for(i=0;i<3600;i++)print "SELECT UNIX_TIMESTAMP(NOW(3)),COUNT(*),COALESCE(SUM(PROCESSLIST_COMMAND!=\047Sleep\047),0) FROM performance_schema.threads WHERE PROCESSLIST_USER=\047ledger_probe\047; DO SLEEP(0.2);"}' > "$METRICS_DIR/sample.sql"
sql < "$METRICS_DIR/sample.sql" > "$METRICS_DIR/connections.tsv" 2>/dev/null & sampler=$!
rc=0; node scripts/profile/queries.mjs || rc=$?
if [[ $rc != 0 ]];then docker logs "$app" --tail 45;exit "$rc";fi
sleep 20; printf 'PROFILE_COOLED ';cat "$METRICS_DIR/current";echo
if [[ ${PROFILE_BUSINESS:-1} == 1 ]]; then
  node scripts/profile/business.mjs || { docker logs "$app" --tail 25; docker logs "$stub" --tail 5; exit 1; }
fi
printf 'PROFILE_KERNEL_PEAK '; docker exec "$app" cat /sys/fs/cgroup/memory.peak
awk 'NF==3{if($2>m)m=$2;if($3>a)a=$3;n++;last=$2}END{printf "PROFILE_MYSQL samples=%d maxConnections=%d maxActive=%d final=%d\n",n,m,a,last; if(n<2 || m<1)exit 1}' "$METRICS_DIR/connections.tsv"
kill "$sampler" 2>/dev/null || :
docker run --rm --network none --entrypoint sh "$image" -c 'du -sk /app /app/node_modules /app/.next; test ! -d /opt/prisma-cli || du -sk /opt/prisma-cli'
