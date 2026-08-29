#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

STATUS_FILE="${MULEDGER_BACKUP_STATUS_FILE:-$HOME/.muledger-backup/status.json}"
MAX_AGE_SECONDS="${MULEDGER_BACKUP_MAX_AGE_SECONDS:-}"

usage() {
  echo "Usage: scripts/backup/check-muledger-local-backup-status.sh [--status STATUS_FILE]" >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --status)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      STATUS_FILE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

case "$MAX_AGE_SECONDS" in
  *[!0-9]*)
    echo "RESULT=INVALID_CONFIGURATION"
    echo "STATUS_FILE=$STATUS_FILE"
    exit 1
    ;;
esac

if [ ! -s "$STATUS_FILE" ]; then
  echo "RESULT=MISSING"
  echo "STATUS_FILE=$STATUS_FILE"
  exit 1
fi

STATUS_FILE="$STATUS_FILE" MAX_AGE_SECONDS="$MAX_AGE_SECONDS" node <<'NODE'
const fs = require('node:fs');

const file = process.env.STATUS_FILE;
let status;
try {
  status = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch {
  console.log('RESULT=INVALID');
  console.log(`STATUS_FILE=${file}`);
  process.exit(1);
}

const configuredMaxAge = process.env.MAX_AGE_SECONDS || status.maxAgeSeconds || 129600;
const maxAgeSeconds = Number(configuredMaxAge);
if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
  console.log('RESULT=INVALID_CONFIGURATION');
  console.log(`STATUS_FILE=${file}`);
  process.exit(1);
}

const successfulAt = Date.parse(status.lastSuccessfulAt || '');
const ageSeconds = Number.isFinite(successfulAt)
  ? Math.max(0, Math.floor((Date.now() - successfulAt) / 1000))
  : -1;
let result = 'HEALTHY';
if (status.status !== 'SUCCESS') result = status.status === 'RUNNING' ? 'RUNNING' : 'FAILED';
else if (ageSeconds < 0) result = 'INVALID';
else if (ageSeconds > maxAgeSeconds) result = 'STALE';

console.log(`RESULT=${result}`);
console.log(`STATUS=${status.status || 'UNKNOWN'}`);
console.log(`LAST_SUCCESSFUL_AT=${status.lastSuccessfulAt || 'NA'}`);
console.log(`AGE_SECONDS=${ageSeconds}`);
console.log(`MAX_AGE_SECONDS=${maxAgeSeconds}`);
console.log(`ATTEMPTS=${Number(status.attempts || 0)}`);
console.log(`EXIT_CODE=${status.exitCode ?? 'NA'}`);
console.log(`STATUS_FILE=${file}`);
process.exit(result === 'HEALTHY' ? 0 : 1);
NODE
