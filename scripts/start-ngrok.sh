#!/usr/bin/env bash
# Crowdwork — HTTPS ngrok tunnel (required for mic/camera)
set -euo pipefail

PORT="${1:-3000}"
NGROK_BIN="${NGROK_BIN:-/tmp/ngrok}"
DOMAIN="${NGROK_DOMAIN:-https://superaccurately-unslandered-trinidad.ngrok-free.dev}"

if [[ ! -x "$NGROK_BIN" ]]; then
  echo "ngrok binary not found at $NGROK_BIN" >&2
  exit 1
fi

echo "Starting HTTPS ngrok → http://localhost:${PORT}"
echo "Use the https:// URL only (never http://) for mic/camera."
echo "Domain: ${DOMAIN}"

# host-header keeps Express happy; HTTPS is the default for ngrok free domains
exec "$NGROK_BIN" http "$PORT" \
  --url "$DOMAIN" \
  --host-header="localhost:${PORT}" \
  --log=stdout
