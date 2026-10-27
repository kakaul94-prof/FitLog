#!/usr/bin/env bash
# Stops the dev server start-app.sh started (no-op if it isn't running).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PID_FILE="$ROOT/e2e-java/app.pid"

[ -f "$PID_FILE" ] || exit 0
pid="$(cat "$PID_FILE")"
case "$(uname)" in
  MINGW* | MSYS* | CYGWIN*) taskkill //PID "$pid" //T //F >/dev/null 2>&1 || true ;;
  *) kill "$pid" >/dev/null 2>&1 || true ;;
esac
rm -f "$PID_FILE"
echo "stop-app: stopped pid $pid"
