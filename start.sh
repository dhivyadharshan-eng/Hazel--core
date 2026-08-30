#!/usr/bin/env bash
# Start Hazel Core on your machine.
#   Requires: Node.js >= 18
#   Optional (for natural neural voice): python3 + edge-tts
#
#   Usage:   bash start.sh          # or make it executable and run ./start.sh

set -e
cd "$(dirname "$0")"

echo "🟣 Hazel Core — starting up..."
PORT="${PORT:-8080}"

# 1) Check Node
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js is not installed."
  echo "   Install it from https://nodejs.org (use the LTS version), then re-run this."
  exit 1
fi
NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "❌ Node.js >= 18 is required (you have $(node -v)). Please upgrade."
  exit 1
fi
echo "✔ Node.js $(node -v)"

# 2) Optional: python + edge-tts for neural voice
python3 -c "import edge_tts" >/dev/null 2>&1 && {
  echo "✔ Voice engine (edge-tts) available — neural voice enabled."
} || {
  echo "ℹ  Voice engine (edge-tts) not found. For neural spoken replies run:"
  echo "     pip3 install edge-tts"
  echo "   Hazel still works — she'll use your browser's voice instead."
}

# 3) Optional: load .env for API keys
if [ -f .env ]; then
  echo "✔ Loaded .env"
  set -a; . ./.env; set +a
fi

# 4) Start
echo ""
echo "───────────────────────────────────────────────"
echo "  Hazel Core is ready at:  http://localhost:${PORT}"
echo "  (press Ctrl+C to stop)"
echo "───────────────────────────────────────────────"
exec node server.mjs
