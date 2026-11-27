#!/usr/bin/env bash
# Cold builds belong on a disposable Linux ARM64 builder, never a live application VM.
set -Eeuo pipefail
trap 'echo "Build failed at line $LINENO (exit $?)" >&2' ERR
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
docker inspect -f 'DRIVER memory={{.HostConfig.Memory}} memorySwap={{.HostConfig.MemorySwap}} quota={{.HostConfig.CpuQuota}} period={{.HostConfig.CpuPeriod}}' "$builder"
cgread(){ docker exec "$builder" cat "/sys/fs/cgroup/$1"; }
memory=$(cgread memory.max); cpu=$(cgread cpu.max); swap=$(cgread memory.swap.max || printf unavailable)
group=$(docker exec "$builder" cat /proc/1/cgroup | awk -F: '$1=="0"{print $3}')
echo "CGROUP group=$group memory=$memory cpu=$cpu swap=$swap hostSwapKiB=$(awk '/^SwapTotal:/{print $2}' /proc/meminfo)"
[[ $group == /* && $memory == "$limit" && $cpu == '200000 100000' ]]
[[ $swap == 0 || $(awk '/^SwapTotal:/{print $2}' /proc/meminfo) == 0 ]]
docker exec "$builder" cat /etc/buildkit/buildkitd.toml | grep -Ei 'max-parallelism[[:space:]]*=[[:space:]]*1([^0-9]|$)'
# Prove that Dockerfile RUN processes inherit the measured cap, not just buildkitd.
base='node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402'
printf 'FROM %s\nRUN node -e "setTimeout(()=>{},5000)" ledger-cgroup-witness\n' "$base" > "$tmp/Dockerfile"
docker buildx build --builder "$name" --platform linux/arm64 "$tmp" >"$tmp/witness.log" 2>&1 & proof=$!
seen=''
while kill -0 "$proof" 2>/dev/null; do
  seen=$(docker exec "$builder" sh -c 'for f in /proc/[0-9]*/comm; do
    [ "$(cat "$f" 2>/dev/null)" = node ] || continue
    p=${f%/comm}; tr "\000" "\n" < "$p/cmdline" | grep -qx ledger-cgroup-witness || continue
    rel=$(cut -d: -f3 "$p/cgroup")
    case "$rel" in /*..*|"") continue;; esac
    if grep -qx "${p##*/}" "/sys/fs/cgroup$rel/cgroup.procs"; then echo "$rel"; break; fi
  done')
  [[ -z $seen ]] || break
  sleep .3
done
wait "$proof" || { cat "$tmp/witness.log"; exit 1; }
[[ $seen == /* && $seen != *..* ]] || { echo "RUN outside/unproven under capped cgroup root: daemon=$group child=$seen" >&2; exit 1; }
echo "BUILD_CAP bytes=$limit cpus=2 parallelism=1 buildkit=$group child=$seen"
# Only tracked sources; a private site environment must never enter the context.
mkdir "$tmp/source"; git archive "${PROFILE_REVISION:-$GITHUB_SHA}" | tar -xf - -C "$tmp/source"
sed "s|^FROM node:22-alpine |FROM $base |" "$tmp/source/Dockerfile" > "$tmp/Pinned.Dockerfile"
if grep -Eq '^FROM node:22-alpine( |$)' "$tmp/Pinned.Dockerfile"; then exit 2; fi
t0=$(date +%s); rc=0
docker buildx build --builder "$name" --platform linux/arm64 --progress plain --load \
  --build-arg CIRCLE_NODE_TOTAL=2 --label "org.opencontainers.image.revision=${PROFILE_REVISION:-$GITHUB_SHA}" \
  -f "$tmp/Pinned.Dockerfile" -t ledger-profile:run "$tmp/source" || rc=$?
echo "BUILD_RESULT exit=$rc seconds=$(($(date +%s)-t0)) peakBytes=$(cgread memory.peak)"
cgread memory.events
[[ $rc == 0 ]] || exit "$rc"
docker image inspect -f 'IMAGE id={{.Id}} size={{.Size}} arch={{.Architecture}} os={{.Os}}' ledger-profile:run
