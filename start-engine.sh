#!/bin/sh
# Start the Director's Cut AI engine on :8788 — one command, zero configuration.
# Demo mode is offline and deterministic (Strands MockModel): no API keys needed.
#
#   ./start-engine.sh          # foreground
#   ./start-engine.sh daemon   # background + wait for /health
#   npm run engine:daemon      # same as daemon (see package.json)
set -eu
cd "$(dirname "$0")/engine"

if curl -fsS http://localhost:8788/health >/dev/null 2>&1; then
  echo "→ engine already running on :8788 (demo mode, no keys required)"
  exit 0
fi

if [ ! -d node_modules ]; then
  echo "→ installing engine dependencies (npm ci)…"
  npm ci --no-progress --silent
fi

if [ "$1" = "daemon" ]; then
  echo "→ starting engine as a daemon (log: engine.log)…"
  nohup npm start > engine.log 2>&1 &
  for i in $(seq 1 30); do
    sleep 0.5
    curl -fsS http://localhost:8788/health >/dev/null 2>&1 && {
      echo "→ engine up: http://localhost:8788  (SRT + media + trivia; MockModel demo mode)"
      exit 0
    }
  done
  echo "✗ engine did not become healthy in 15 s — see engine/engine.log" >&2
  exit 1
else
  echo "→ starting engine in the foreground (Ctrl-C stops)…  "
  exec npm start
fi
