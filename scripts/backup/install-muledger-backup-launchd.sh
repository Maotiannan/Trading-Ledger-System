#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LABEL="${LABEL:-com.muledger.local-backup}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LEGACY_PLIST="$HOME/Library/LaunchAgents/com.muledger.cos-backup.plist"
BACKUP_HOME="${MULEDGER_BACKUP_HOME:-$HOME/.muledger-backup}"
ENV_FILE="${MULEDGER_BACKUP_ENV:-$BACKUP_HOME/muledger-backup.env}"
HOUR="${BACKUP_HOUR:-2}"
MINUTE="${BACKUP_MINUTE:-30}"

mkdir -p "$HOME/Library/LaunchAgents" "$BACKUP_HOME/logs"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
      <key>ProgramArguments</key>
      <array>
        <string>$ROOT_DIR/scripts/backup/muledger-local-backup.sh</string>
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
</dict>
</plist>
EOF

launchctl unload "$LEGACY_PLIST" >/dev/null 2>&1 || true
rm -f "$LEGACY_PLIST"
launchctl unload "$PLIST" >/dev/null 2>&1 || true
launchctl load "$PLIST"

echo "Installed launchd backup job: $PLIST"
echo "Schedule: every day at $(printf '%02d:%02d' "$HOUR" "$MINUTE")"
echo "Logs: $BACKUP_HOME/logs/launchd.out.log and launchd.err.log"
echo "Dry run:"
echo "$ROOT_DIR/scripts/backup/muledger-local-backup.sh --env $ENV_FILE --dry-run"
echo "Manual backup:"
echo "$ROOT_DIR/scripts/backup/muledger-local-backup.sh --env $ENV_FILE"
