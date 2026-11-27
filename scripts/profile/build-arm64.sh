#!/usr/bin/env bash
# Cold builds belong on a disposable Linux ARM64 builder, never a live application VM.
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_ARCH:-} == ARM64 && $(uname -m) == aarch64 ]] || { echo 'Requires the dedicated native ARM64 Actions runner.' >&2; exit 2; }
: "${RUNNER_TEMP:?}" "${GITHUB_SHA:?}"
total=$(docker info --format '{{.MemTotal}}')
limit=${BUILD_MEMORY_BYTES:-5368709120}
[[ $limit =~ ^[0-9]+$ && $limit -gt 0 && $((total - limit)) -ge 2147483648 ]] || { echo 'Insufficient build memory with 2 GiB reserved.' >&2; exit 2; }
name="ledgerbuild-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
tmp=$(mktemp -d "$RUNNER_TEMP/ledger-build-XXXX")
printf '[worker.oci]\n  max-parallelism = 1\n' > "$tmp/buildkit.toml"
docker buildx create --name "$name" --driver docker-container --buildkitd-config "$tmp/buildkit.toml" \
  --driver-opt "memory=$limit,memory-swap=$limit,cpu-period=100000,cpu-quota=200000" --bootstrap
trap 'docker buildx rm "$name" >/dev/null' EXIT
builder="buildx_buildkit_${name}0"
pid=$(docker inspect -f '{{.State.Pid}}' "$builder")
group=$(awk -F: '$1=="0"{print $3}' "/proc/$pid/cgroup")
[[ $group == /* && $group != / ]]
cg="/sys/fs/cgroup$group"
test "$(cat "$cg/memory.max")" = "$limit"
test "$(cat "$cg/memory.swap.max")" = 0
test "$(cat "$cg/cpu.max")" = '200000 100000'
docker exec "$builder" cat /etc/buildkit/buildkitd.toml | grep -E 'max-parallelism = 1'
# Prove that Dockerfile RUN processes inherit the measured cap, not just buildkitd.
base='node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402'
printf 'FROM %s\nRUN node -e "setTimeout(()=>{},5000)" ledger-cgroup-witness\n' "$base" > "$tmp/Dockerfile"
docker buildx build --builder "$name" --platform linux/arm64 "$tmp" >"$tmp/witness.log" 2>&1 & proof=$!
seen=''
while kill -0 "$proof" 2>/dev/null; do
  wp=$(ps -eo pid=,comm=,args= | awk '$2=="node" && $NF=="ledger-cgroup-witness"{print $1;exit}')
  if [[ -n $wp && -r /proc/$wp/cgroup ]]; then
    seen=$(awk -F: '$1=="0"{print $3}' "/proc/$wp/cgroup"); break
  fi
  sleep .15
done
wait "$proof" || { cat "$tmp/witness.log"; exit 1; }
[[ $seen == "$group" || $seen == "$group/"* ]] || { echo "RUN escaped/unproven: builder=$group child=$seen" >&2; exit 1; }
echo "BUILD_CAP bytes=$limit cpus=2 parallelism=1 buildkit=$group child=$seen"
# Only tracked sources; a private site environment must never enter the context.
mkdir "$tmp/source"; git archive "$GITHUB_SHA" | tar -xf - -C "$tmp/source"
sed "s|^FROM node:22-alpine |FROM $base |" "$tmp/source/Dockerfile" > "$tmp/Pinned.Dockerfile"
if grep -Eq '^FROM node:22-alpine( |$)' "$tmp/Pinned.Dockerfile"; then exit 2; fi
t0=$(date +%s); rc=0
docker buildx build --builder "$name" --platform linux/arm64 --progress plain --load \
  --build-arg CIRCLE_NODE_TOTAL=2 --label "org.opencontainers.image.revision=$GITHUB_SHA" \
  -f "$tmp/Pinned.Dockerfile" -t ledger-profile:run "$tmp/source" || rc=$?
echo "BUILD_RESULT exit=$rc seconds=$(($(date +%s)-t0)) peakBytes=$(cat "$cg/memory.peak")"
cat "$cg/memory.events"
[[ $rc == 0 ]] || exit "$rc"
docker image inspect -f 'IMAGE id={{.Id}} size={{.Size}} arch={{.Architecture}} os={{.Os}}' ledger-profile:run
