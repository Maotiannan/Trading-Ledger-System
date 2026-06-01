#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
COSCLI_PATH="$INSTALL_DIR/coscli"

arch="$(uname -m)"
case "$arch" in
  arm64)
    url="https://cosbrowser.cloud.tencent.com/software/coscli/coscli-darwin-arm64"
    ;;
  x86_64)
    url="https://cosbrowser.cloud.tencent.com/software/coscli/coscli-darwin-amd64"
    ;;
  *)
    echo "Unsupported macOS architecture: $arch" >&2
    exit 1
    ;;
esac

mkdir -p "$INSTALL_DIR"
tmp_file="$(mktemp)"
trap 'rm -f "$tmp_file"' EXIT

curl -fL "$url" -o "$tmp_file"
chmod 755 "$tmp_file"
mv "$tmp_file" "$COSCLI_PATH"

echo "COSCLI installed: $COSCLI_PATH"
"$COSCLI_PATH" --version

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo "Add this to your shell profile if coscli is not found automatically:"
    echo "export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac
