#!/usr/bin/env bash
# Points the Java suite at the LOCAL stack and starts the app under test.
#
#   source e2e-java/scripts/start-app.sh     # exports SUPABASE_* + FITLOG_BASE_URL, starts Vite on :5174
#   bash   e2e-java/scripts/start-app.sh     # in GitHub Actions: also appends them to $GITHUB_ENV
#
# The Supabase URL and keys come from the running local stack (`supabase status`, via the API
# suite's local-env.sh), never from this repo. The dev server gets them as VITE_* variables,
# exactly as playwright.config.ts does, so a developer's .env (which may hold a hosted project)
# is never used. Port 5174 keeps it apart from a normal `npm run dev` on 5173. The server uses
# e2e-java/vite.e2e.config.ts: the app's own config with live reload off (see that file).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${FITLOG_PORT:-5174}"
LOG="$ROOT/e2e-java/app.log"
PID_FILE="$ROOT/e2e-java/app.pid"

# `supabase status` reads supabase/config.toml from the current directory, so run it from the root.
# In GitHub Actions local-env.sh writes to $GITHUB_ENV instead of exporting; hide that variable
# while sourcing so this shell gets the values too (they are appended to $GITHUB_ENV below).
github_env="${GITHUB_ENV:-}"
unset GITHUB_ENV
pushd "$ROOT" >/dev/null
# shellcheck source=../../api-tests/scripts/local-env.sh
source "$ROOT/api-tests/scripts/local-env.sh"
env_ok=$?
popd >/dev/null
[ -n "$github_env" ] && export GITHUB_ENV="$github_env"
if [ "$env_ok" -ne 0 ]; then
  echo "start-app: the local Supabase stack isn't running. Start it with: npm run db:start" >&2
  return 1 2>/dev/null || exit 1
fi

export FITLOG_BASE_URL="http://localhost:$PORT"

if curl -sf "$FITLOG_BASE_URL" >/dev/null 2>&1; then
  echo "start-app: app already running at $FITLOG_BASE_URL"
else
  (
    cd "$ROOT" &&
      VITE_SUPABASE_URL="$SUPABASE_URL" \
      VITE_SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
      VITE_USDA_API_KEY="e2e-dummy-key" \
      nohup node node_modules/vite/bin/vite.js --config e2e-java/vite.e2e.config.ts \
        --port "$PORT" --strictPort >"$LOG" 2>&1 &
    echo $! >"$PID_FILE"
  )
  for _ in $(seq 1 60); do
    curl -sf "$FITLOG_BASE_URL" >/dev/null 2>&1 && break
    sleep 1
  done
  if curl -sf "$FITLOG_BASE_URL" >/dev/null 2>&1; then
    echo "start-app: app running at $FITLOG_BASE_URL (pid $(cat "$PID_FILE"), log $LOG)"
  else
    echo "start-app: the dev server didn't come up; last lines of $LOG:" >&2
    tail -n 20 "$LOG" >&2
    return 1 2>/dev/null || exit 1
  fi
fi

# Later workflow steps (the Maven run) read these from the job environment. The keys are the
# CLI's local-only values, but they are masked in the log all the same.
if [ -n "${GITHUB_ENV:-}" ]; then
  {
    echo "FITLOG_BASE_URL=$FITLOG_BASE_URL"
    echo "SUPABASE_URL=$SUPABASE_URL"
    echo "SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY"
    echo "SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY"
  } >>"$GITHUB_ENV"
  echo "::add-mask::$SUPABASE_ANON_KEY"
  echo "::add-mask::$SUPABASE_SERVICE_ROLE_KEY"
fi
