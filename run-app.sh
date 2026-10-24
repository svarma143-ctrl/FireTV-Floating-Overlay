#!/bin/zsh
# Build (first run only) and launch Director's Cut on the Vega Virtual Device.
# Prereq: Amazon Vega SDK installed (`source ~/vega/env` works) — see README "Prerequisites".
#   ./run-app.sh
set -eu
cd "$(dirname "$0")"
ZSHRC_ENV="${VEGA_ENV:-$HOME/vega/env}"
if [ -f "$ZSHRC_ENV" ]; then
  # propagate only what vega/vda need into this env
  set -a
  # shellcheck disable=SC1090
  . "$ZSHRC_ENV"
  set +a
fi
command -v vega >/dev/null 2>&1 || {
  echo "✗ 'vega' CLI not found — install the Vega SDK and adjust VEGA_ENV if non-default." >&2
  exit 1
}

VPKG=$(ls -t build/aarch64-debug/*.vpkg 2>/dev/null | head -1 || true)
if [ -z "$VPKG" ]; then
  echo "→ no .vpkg found — building Debug (first run takes a few minutes)…"
  npx react-native build-vega --build-type Debug
  VPKG=$(ls -t build/aarch64-debug/*.vpkg 2>/dev/null | head -1 || true)
  [ -n "$VPKG" ] || { echo "✗ build produced no .vpkg" >&2; exit 1; }
fi
PKGID="com.directorscut.app72.main"
echo "→ deploying $VPKG to VirtualDevice…"
exec vega run-app "$VPKG" "$PKGID" -d VirtualDevice
