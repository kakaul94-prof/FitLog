#!/usr/bin/env bash
# Runs one k6 scenario against the LOCAL Supabase stack, and nothing else.
#
#   bash perf-tests/run.sh <smoke|load|stress|spike|soak> [k6 args…]
#   bash perf-tests/run.sh cleanup      # delete any @perf.test users a stopped run left
#
# (`make perf-smoke` etc. wrap these.) In order, it:
#   1. refuses anything but a local stack — here in bash, and again inside k6
#      (lib/env.ts), which also checks the keys' JWT claims
#   2. exports the stack's URLs and keys (api-tests/scripts/local-env.sh)
#   3. starts the Pages Functions with the Claude stub, unless
#      FITLOG_FUNCTIONS_URL is already set, bounding what the stub records
#   4. runs k6: the native binary if installed, else the pinned grafana/k6 image
#      on the stack's Docker network, writing reports/perf/<scenario>/
#      (summary.json, headline.json, report.html)
#   5. gives the verdict (scripts/check-run.mjs: thresholds, soak drift, report-only)
#   6. always, even after Ctrl-C: deletes every @perf.test user
#
# Knobs, all optional:
#   VUS, SOAK_DURATION, THINK_SCALE, POOL_SIZE, SEED_DAYS   see config/profiles.ts
#   PERF_LAX=1          relaxed latency budgets (what CI uses for the smoke gate)
#   PERF_NO_FUNCTIONS=1 skip the trainer journey (no functions server)
#   K6_BIN, K6_IMAGE    which k6 to run
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
K6_VERSION="2.3.0"
K6_IMAGE="${K6_IMAGE:-grafana/k6:$K6_VERSION}"
SCENARIO="${1:-}"
shift || true

die() { echo "perf: $*" >&2; exit 1; }
usage() { sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'; }

case "$SCENARIO" in
  smoke|load|stress|spike|soak|cleanup) ;;
  ''|-h|--help) usage; exit 0 ;;
  *) usage; die "unknown scenario '$SCENARIO'" ;;
esac

# The suite's own virtualenv if it has one, else the Python on PATH (for the stub).
python_bin() {
  for candidate in api-tests/.venv/bin/python api-tests/.venv/Scripts/python.exe; do
    [ -x "$candidate" ] && { echo "$ROOT/$candidate"; return; }
  done
  command -v python3 || command -v python || die "Python 3.12+ is required to run the Claude stub"
}

# --- 1 + 2. the stack: local, or nothing --------------------------------------
if [ -z "${SUPABASE_URL:-}" ]; then
  npx --no-install supabase status >/dev/null 2>&1 || die "the local Supabase stack isn't running: make stack-up"
  # shellcheck source=../api-tests/scripts/local-env.sh
  source api-tests/scripts/local-env.sh >/dev/null
fi
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is not set}" "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is not set}"
case "$SUPABASE_URL" in
  *supabase.co*|*supabase.in*|*pages.dev*|*workers.dev*) die "refusing to run against a hosted project ($SUPABASE_URL)" ;;
esac
host="$(printf '%s' "$SUPABASE_URL" | sed -E 's#^[a-z]+://##; s#[/:?].*$##')"
case "$host" in
  127.0.0.1|localhost|::1|host.docker.internal) ;;
  *) die "SUPABASE_URL must be the local stack, got host '$host'" ;;
esac

# --- the runner ----------------------------------------------------------------
K6_BIN="${K6_BIN:-k6}"
if command -v "$K6_BIN" >/dev/null 2>&1; then
  RUNNER=native
else
  command -v docker >/dev/null 2>&1 || die "k6 isn't installed and neither is Docker. Install k6: https://grafana.com/docs/k6/latest/set-up/install-k6/"
  docker info >/dev/null 2>&1 || die "k6 isn't installed and Docker isn't running"
  RUNNER=docker
fi

# --- 3. the functions server + Claude stub --------------------------------------
STARTED_FUNCTIONS=
if [ "$SCENARIO" != cleanup ] && [ -z "${PERF_NO_FUNCTIONS:-}" ] && [ -z "${FITLOG_FUNCTIONS_URL:-}" ]; then
  PY="$(python_bin)"
  "$PY" -c 'import testkit' 2>/dev/null || die "the testkit isn't installed for $PY (the Claude stub needs it): pip install -e ./testkit, or PERF_NO_FUNCTIONS=1 to skip the trainer journey"
  # Own ports and run dir, so a perf run never shares (or mistakes for its own)
  # the API suite's functions server on 8788/8790, in this checkout or another.
  export FUNCTIONS_PORT="${FUNCTIONS_PORT:-8798}" STUB_PORT="${STUB_PORT:-8799}"
  export FUNCTIONS_RUN_DIR="$ROOT/reports/perf/functions"
  # A soak makes thousands of trainer calls; keep the stub from remembering every one.
  export STUB_MAX_RECORDED="${STUB_MAX_RECORDED:-200}"
  # From the k6 container the functions are reached through the host alias, so
  # wrangler has to listen beyond loopback.
  [ "$RUNNER" = docker ] && export FUNCTIONS_IP=0.0.0.0
  PYTHON="$PY" bash api-tests/scripts/start-functions.sh --bg >/dev/null || die "could not start the Pages Functions on port $FUNCTIONS_PORT (see reports/perf/functions/*.log)"
  STARTED_FUNCTIONS=1
  export FITLOG_FUNCTIONS_URL="http://127.0.0.1:$FUNCTIONS_PORT"
fi

# --- 4. run ---------------------------------------------------------------------
OUT="reports/perf/$SCENARIO"
export PERF_GIT_SHA="${PERF_GIT_SHA:-$(git rev-parse --short HEAD 2>/dev/null || echo local)}"
export PERF_GIT_BRANCH="${PERF_GIT_BRANCH:-${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo local)}}}"
if [ "$SCENARIO" = smoke ] && [ -n "${CI:-}" ]; then export PERF_LAX="${PERF_LAX:-1}"; fi

# Everything k6 reads through __ENV, plus its own dashboard settings.
PASS_ENV=(SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY FITLOG_FUNCTIONS_URL PERF_OUT PERF_LAX
  PERF_GIT_SHA PERF_GIT_BRANCH VUS SOAK_DURATION THINK_SCALE POOL_SIZE SEED_DAYS
  K6_WEB_DASHBOARD K6_WEB_DASHBOARD_EXPORT K6_WEB_DASHBOARD_PORT)

# run_k6 <script, relative to perf-tests/> [k6 args…]
run_k6() {
  local script="$1"
  shift
  if [ "$RUNNER" = native ]; then
    (cd perf-tests && "$K6_BIN" run "$script" "$@")
    return
  fi
  local network kong host_root
  network="$(docker network ls --format '{{.Name}}' | grep -m1 '^supabase_network_' || true)"
  kong="$(docker ps --format '{{.Names}}' | grep -m1 '^supabase_kong_' || true)"
  [ -n "$network" ] && [ -n "$kong" ] || die "could not find the stack's Docker network and Kong container (is it running?)"
  host_root="$ROOT"
  case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) host_root="$(cygpath -w "$ROOT")" ;; esac
  local -a flags=()
  [ "$(uname -s)" = Linux ] && flags+=(--user "$(id -u):$(id -g)")
  (
    # Inside the container: Kong by its container name, the functions through the host alias.
    export SUPABASE_URL="http://$kong:8000"
    [ -n "${FITLOG_FUNCTIONS_URL:-}" ] && export FITLOG_FUNCTIONS_URL="${FITLOG_FUNCTIONS_URL//127.0.0.1/host.docker.internal}"
    FITLOG_FUNCTIONS_URL="${FITLOG_FUNCTIONS_URL//localhost/host.docker.internal}"
    for name in "${PASS_ENV[@]}"; do [ -n "${!name:-}" ] && flags+=(-e "$name=${!name}"); done
    MSYS_NO_PATHCONV=1 docker run --rm --network "$network" --add-host host.docker.internal:host-gateway \
      ${flags[@]+"${flags[@]}"} -v "$host_root:/work" -w /work/perf-tests "$K6_IMAGE" run "$script" "$@"
  )
}

# --- 6. always clean up ------------------------------------------------------------
cleanup_users() {
  K6_WEB_DASHBOARD=false PERF_OUT= run_k6 scripts/cleanup.ts --quiet --summary-mode=disabled ||
    echo "perf: the clean-up did not finish; run: bash perf-tests/run.sh cleanup" >&2
}
on_exit() {
  [ "$SCENARIO" = cleanup ] || cleanup_users
  if [ -n "$STARTED_FUNCTIONS" ]; then FUNCTIONS_RUN_DIR="$ROOT/reports/perf/functions" bash api-tests/scripts/start-functions.sh --stop >/dev/null 2>&1 || true; fi
}
trap on_exit EXIT

if [ "$SCENARIO" = cleanup ]; then
  K6_WEB_DASHBOARD=false run_k6 scripts/cleanup.ts --quiet --summary-mode=disabled
  exit 0
fi

rm -rf "$OUT" # the functions' logs live beside it in reports/perf/functions, untouched
mkdir -p "$OUT"
if [ "$RUNNER" = native ]; then PERF_OUT="$ROOT/$OUT"; else PERF_OUT="/work/$OUT"; fi
export PERF_OUT
export K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT="$PERF_OUT/report.html" K6_WEB_DASHBOARD_PORT=-1

echo "perf: $SCENARIO · $RUNNER k6 $K6_VERSION · stack $SUPABASE_URL · functions ${FITLOG_FUNCTIONS_URL:-off} → $OUT/"
set +e
run_k6 "scenarios/$SCENARIO.ts" "$@"
code=$?
set -e

# --- 5. the verdict --------------------------------------------------------------
node perf-tests/scripts/check-run.mjs "$OUT" "$code"
