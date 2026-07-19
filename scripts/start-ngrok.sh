#!/usr/bin/env bash
# Crowdwork — bind dedicated HTTPS ngrok domain to local Express (:3000)
# Retries until ERR_NGROK_334 clears (stale remote agent released the domain).
set -uo pipefail

PORT="${1:-3000}"
NGROK_BIN="${NGROK_BIN:-/tmp/ngrok}"
DOMAIN="${NGROK_DOMAIN:-https://superaccurately-unslandered-trinidad.ngrok-free.dev}"
LOG="${NGROK_LOG:-/tmp/ngrok.log}"
RETRY_SECONDS="${NGROK_RETRY_SECONDS:-8}"

if [[ ! -x "$NGROK_BIN" ]]; then
  echo "ngrok binary not found at $NGROK_BIN" >&2
  exit 1
fi

# Ensure no leftover local agents
pkill -f "$NGROK_BIN http" 2>/dev/null || true
sleep 0.5

echo "Crowdwork ngrok binder"
echo "  target : http://localhost:${PORT}"
echo "  domain : ${DOMAIN}"
echo "  note   : use the https:// URL only (mic/camera require secure context)"
echo

attempt=1
while true; do
  echo "[attempt ${attempt}] starting ngrok…"
  : >"$LOG"
  set +e
  "$NGROK_BIN" http "$PORT" \
    --url "$DOMAIN" \
    --log=stdout 2>&1 | tee "$LOG"
  code=${PIPESTATUS[0]}
  set -e

  if rg -q "started tunnel|client session established" "$LOG" \
    && ! rg -q "ERR_NGROK_334" "$LOG"; then
    echo "ngrok exited unexpectedly (code=${code}); restarting in ${RETRY_SECONDS}s…"
  elif rg -q "ERR_NGROK_334" "$LOG"; then
    echo "ERR_NGROK_334: domain still held by another agent."
    echo "  → Stop the other ngrok session (dashboard Agents / your laptop), then this will bind automatically."
  else
    echo "ngrok exited (code=${code})."
  fi

  attempt=$((attempt + 1))
  sleep "$RETRY_SECONDS"
done
