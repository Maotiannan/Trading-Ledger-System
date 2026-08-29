#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LABEL="${LABEL:-com.muledger.local-backup}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LEGACY_PLIST="$HOME/Library/LaunchAgents/com.muledger.cos-backup.plist"
BACKUP_HOME="${MULEDGER_BACKUP_HOME:-$HOME/.muledger-backup}"
ENV_FILE="${MULEDGER_BACKUP_ENV:-$BACKUP_HOME/muledger-backup.env}"
RUNNER="$ROOT_DIR/scripts/backup/run-muledger-local-backup-docker.sh"
DOCKERFILE="$ROOT_DIR/scripts/backup/Dockerfile"
HOUR="${BACKUP_HOUR:-2}"
MINUTE="${BACKUP_MINUTE:-30}"

mkdir -p "$HOME/Library/LaunchAgents" "$BACKUP_HOME/logs"

[ -f "$ENV_FILE" ] || { echo "Backup environment file not found: $ENV_FILE" >&2; exit 1; }
[ -x "$RUNNER" ] || { echo "Backup Docker runner is not executable: $RUNNER" >&2; exit 1; }
[ -x "$ROOT_DIR/scripts/backup/check-muledger-local-backup-status.sh" ] || {
  echo "Backup status checker is not executable" >&2
  exit 1
}
if stat -f '%Lp' "$ENV_FILE" >/dev/null 2>&1; then
  ENV_MODE="$(stat -f '%Lp' "$ENV_FILE")"
else
  ENV_MODE="$(stat -c '%a' "$ENV_FILE")"
fi
[ "$ENV_MODE" = "600" ] || { echo "Backup environment file must use mode 600: $ENV_FILE" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Docker CLI is not available" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker Desktop is not running" >&2; exit 1; }

MULEDGER_BACKUP_DOCKER_IMAGE="$(
  # Source the private file only in this subshell so database credentials are not inherited by docker build.
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  printf '%s' "${MULEDGER_BACKUP_DOCKER_IMAGE:-muledger-local-backup:1}"
)"

echo "Building dedicated backup image: $MULEDGER_BACKUP_DOCKER_IMAGE"
docker build --pull=false \
  --tag "$MULEDGER_BACKUP_DOCKER_IMAGE" \
  --file "$DOCKERFILE" \
  "$ROOT_DIR/scripts/backup"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
      <key>ProgramArguments</key>
      <array>
        <string>$RUNNER</string>
    <string>--env</string>
    <string>$ENV_FILE</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>$HOUR</integer>
    <key>Minute</key>
    <integer>$MINUTE</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>$BACKUP_HOME/logs/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>$BACKUP_HOME/logs/launchd.err.log</string>
  <key>WorkingDirectory</key>
  <string>$ROOT_DIR</string>
  <key>ProcessType</key>
  <string>Background</string>
  <key>LowPriorityIO</key>
  <true/>
  <key>Nice</key>
  <integer>10</integer>
  <key>ThrottleInterval</key>
  <integer>60</integer>
</dict>
</plist>
EOF
plutil -lint "$PLIST" >/dev/null

launchctl bootout "gui/$(id -u)" "$LEGACY_PLIST" >/dev/null 2>&1 || true
rm -f "$LEGACY_PLIST"
launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Installed launchd backup job: $PLIST"
echo "Schedule: every day at $(printf '%02d:%02d' "$HOUR" "$MINUTE")"
echo "Logs: $BACKUP_HOME/logs/launchd.out.log and launchd.err.log"
echo "Dry run:"
echo "$RUNNER --env $ENV_FILE --dry-run"
echo "Manual backup:"
echo "$RUNNER --env $ENV_FILE"
echo "Status check:"
echo "$ROOT_DIR/scripts/backup/check-muledger-local-backup-status.sh"
