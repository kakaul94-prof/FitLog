#!/usr/bin/env bash
# Runs FitLog's Pages Functions locally for the API tests, with the Claude API
# swapped for the recording stub (api-tests/testkit/anthropic_stub.py).
#
#   bash api-tests/scripts/start-functions.sh          # foreground; Ctrl-C stops both
#   bash api-tests/scripts/start-functions.sh --bg     # background; prints the env to export
#   bash api-tests/scripts/start-functions.sh --stop   # stop a background run
#
# Needs the local Supabase stack's variables first:
#   source api-tests/scripts/local-env.sh
# The functions verify sign-ins against that stack, exactly as they do against
# the hosted project in production.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN_DIR="$ROOT/reports/functions"
FUNCTIONS_PORT="${FUNCTIONS_PORT:-8788}"
STUB_PORT="${STUB_PORT:-8790}"
PYTHON="${PYTHON:-python}"

# Must match FAKE_ANTHROPIC_KEY in api-tests/testkit/config.py. Not a real key:
# the stub never checks it, the tests check it is sent and never echoed back.
FAKE_ANTHROPIC_KEY="sk-ant-test-local-stub-key"
# Production waits much longer; tests use a short upstream timeout so the
# "Claude never answers" case finishes in seconds.
ANTHROPIC_TIMEOUT_MS="${ANTHROPIC_TIMEOUT_MS:-2000}"

# shellcheck source=../../scripts/lib/background.sh
source "$ROOT/scripts/lib/background.sh"

stop() {
  [ -f "$RUN_DIR/pids" ] || return 0
  while read -r pid; do stop_tree "$pid"; done <"$RUN_DIR/pids"
  rm -f "$RUN_DIR/pids"
}

if [ "${1:-}" = "--stop" ]; then
  stop
  echo "start-functions: stopped"
  exit 0
fi

: "${SUPABASE_URL:?run 'source api-tests/scripts/local-env.sh' first (the stack must be up)}"
: "${SUPABASE_ANON_KEY:?run 'source api-tests/scripts/local-env.sh' first}"

# The functions only need a directory of static assets to sit beside. Use the
# built app when there is one: it's the closest to what production serves.
ASSETS="$ROOT/dist"
[ -d "$ASSETS" ] || ASSETS="$ROOT/public"

mkdir -p "$RUN_DIR"
stop

cd "$ROOT/api-tests"
start_bg "$RUN_DIR/stub.log" "$PYTHON" -m testkit.anthropic_stub --port "$STUB_PORT"
echo "$BG_PID" >>"$RUN_DIR/pids"

cd "$ROOT"
export WRANGLER_SEND_METRICS=false
start_bg "$RUN_DIR/wrangler.log" npx --no-install wrangler pages dev "$ASSETS" \
  --ip 127.0.0.1 --port "$FUNCTIONS_PORT" \
  --compatibility-date 2025-01-01 \
  --binding "VITE_SUPABASE_URL=$SUPABASE_URL" \
  --binding "VITE_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY" \
  --binding "ANTHROPIC_API_KEY=$FAKE_ANTHROPIC_KEY" \
  --binding "ANTHROPIC_BASE_URL=http://127.0.0.1:$STUB_PORT" \
  --binding "ANTHROPIC_TIMEOUT_MS=$ANTHROPIC_TIMEOUT_MS"
echo "$BG_PID" >>"$RUN_DIR/pids"

# Ready when an unauthenticated trainer call is refused (the function is
# loaded and answering) and the stub answers its control endpoint.
for _ in $(seq 1 60); do
  status=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    "http://127.0.0.1:$FUNCTIONS_PORT/api/trainer" || true)
  if [ "$status" = "401" ] && curl -sf "http://127.0.0.1:$STUB_PORT/__stub/calls" >/dev/null; then
    env_lines="FITLOG_FUNCTIONS_URL=http://127.0.0.1:$FUNCTIONS_PORT
FITLOG_STUB_URL=http://127.0.0.1:$STUB_PORT"
    if [ -n "${GITHUB_ENV:-}" ]; then echo "$env_lines" >>"$GITHUB_ENV"; fi
    echo "start-functions: ready. Export these for pytest:"
    echo "$env_lines" | sed 's/^/  export /'
    if [ "${1:-}" != "--bg" ]; then
      trap stop EXIT INT TERM
      wait
    fi
    exit 0
  fi
  sleep 1
done

echo "start-functions: the functions server did not come up within 60s. Last log lines:" >&2
tail -n 30 "$RUN_DIR/wrangler.log" "$RUN_DIR/stub.log" >&2
stop
exit 1
