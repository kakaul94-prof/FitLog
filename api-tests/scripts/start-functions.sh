#!/usr/bin/env bash
# Runs FitLog's Pages Functions locally for the API tests, with the Claude API
# swapped for the recording stub (testkit/src/testkit/anthropic_stub.py).
#
#   bash api-tests/scripts/start-functions.sh          # foreground; Ctrl-C stops both
#   bash api-tests/scripts/start-functions.sh --bg     # background; prints the env to export
#   bash api-tests/scripts/start-functions.sh --stop   # stop a background run
#
# UPSTREAM_URL=http://127.0.0.1:8791 points the functions at that address
# instead of starting the stub: the AI evals' live tier uses it for its
# recording, budget-capped proxy to the real Claude API (ai-evals/aievals/proxy.py),
# with production's timeout.
#
# Needs the local Supabase stack's variables first:
#   source api-tests/scripts/local-env.sh
# The functions verify sign-ins against that stack, exactly as they do against
# the hosted project in production.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN_DIR="${FUNCTIONS_RUN_DIR:-$ROOT/reports/functions}" # pids + logs; perf-tests keeps its own
FUNCTIONS_PORT="${FUNCTIONS_PORT:-8788}"
STUB_PORT="${STUB_PORT:-8790}"
PYTHON="${PYTHON:-python}"

# Must match FAKE_ANTHROPIC_KEY in testkit/src/testkit/config.py. Not a real key:
# the stub never checks it, the tests check it is sent and never echoed back.
FAKE_ANTHROPIC_KEY="sk-ant-test-local-stub-key"
UPSTREAM_URL="${UPSTREAM_URL:-}"
# Production waits much longer; tests use a short upstream timeout so the
# "Claude never answers" case finishes in seconds. Against a real upstream,
# use production's own default.
if [ -n "$UPSTREAM_URL" ]; then
  ANTHROPIC_TIMEOUT_MS="${ANTHROPIC_TIMEOUT_MS:-20000}"
else
  ANTHROPIC_TIMEOUT_MS="${ANTHROPIC_TIMEOUT_MS:-2000}"
fi

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

# A server that is already answering on the port belongs to someone else (a
# second checkout, another suite): wrangler would fail to bind and the
# readiness check below would mistake that server for ours.
if curl -s -o /dev/null "http://127.0.0.1:$FUNCTIONS_PORT/" 2>/dev/null; then
  echo "start-functions: something is already listening on 127.0.0.1:$FUNCTIONS_PORT; stop it or set FUNCTIONS_PORT" >&2
  exit 1
fi

if [ -z "$UPSTREAM_URL" ]; then
  cd "$ROOT/api-tests"
  # STUB_MAX_RECORDED=N keeps only the newest N calls. The load tests set it: a
  # soak makes thousands of trainer calls and never reads them back.
  stub_args=(--port "$STUB_PORT")
  [ -n "${STUB_MAX_RECORDED:-}" ] && stub_args+=(--max-recorded "$STUB_MAX_RECORDED")
  start_bg "$RUN_DIR/stub.log" "$PYTHON" -m testkit.anthropic_stub "${stub_args[@]}"
  echo "$BG_PID" >>"$RUN_DIR/pids"
  UPSTREAM="http://127.0.0.1:$STUB_PORT"
else
  UPSTREAM="$UPSTREAM_URL"
fi

cd "$ROOT"
export WRANGLER_SEND_METRICS=false
# FUNCTIONS_IP=0.0.0.0 when the caller is in a container: perf-tests/run.sh
# running k6 in Docker reaches the functions through host.docker.internal.
start_bg "$RUN_DIR/wrangler.log" npx --no-install wrangler pages dev "$ASSETS" \
  --ip "${FUNCTIONS_IP:-127.0.0.1}" --port "$FUNCTIONS_PORT" \
  --compatibility-date 2025-01-01 \
  --compatibility-flags nodejs_als \
  --binding "VITE_SUPABASE_URL=$SUPABASE_URL" \
  --binding "VITE_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY" \
  --binding "ANTHROPIC_API_KEY=$FAKE_ANTHROPIC_KEY" \
  --binding "ANTHROPIC_BASE_URL=$UPSTREAM" \
  --binding "ANTHROPIC_TIMEOUT_MS=$ANTHROPIC_TIMEOUT_MS"
echo "$BG_PID" >>"$RUN_DIR/pids"

stub_ready() {
  [ -n "$UPSTREAM_URL" ] || curl -sf "http://127.0.0.1:$STUB_PORT/__stub/calls" >/dev/null
}

# Ready when an unauthenticated trainer call is refused (the function is
# loaded and answering) and the stub, if there is one, answers its control
# endpoint.
for _ in $(seq 1 60); do
  status=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    "http://127.0.0.1:$FUNCTIONS_PORT/api/trainer" || true)
  if [ "$status" = "401" ] && stub_ready; then
    env_lines="FITLOG_FUNCTIONS_URL=http://127.0.0.1:$FUNCTIONS_PORT"
    [ -n "$UPSTREAM_URL" ] || env_lines="$env_lines
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
tail -n 30 "$RUN_DIR"/*.log >&2
stop
exit 1
