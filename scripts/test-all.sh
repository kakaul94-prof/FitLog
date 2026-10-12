#!/usr/bin/env bash
# One entry point for every test layer. The Makefile's targets call this, so it
# also works where `make` isn't installed (Git Bash on Windows):
#
#   bash scripts/test-all.sh <command> [extra pytest args for test-api]
#
#   stack-up       start the local Supabase stack (Docker)
#   test-unit      Vitest unit tests
#   test-api       API / database / security suite (pytest + pytest-bdd)
#   test-ai        AI trainer evals, tier 1: deterministic, Claude replaced by a stub
#   test-e2e       Playwright E2E, in its container
#   test-security  security scans: gitleaks, npm audit, pip-audit, ZAP (report only)
#   test           unit, API, AI evals, then E2E; stops at the first failing layer
#   report         build the Allure report from the last API and AI-eval runs and open it
#   stack-down     stop the stack (and the functions server, if running)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ALLURE="allure-commandline@2.46.1"

die() { echo "test-all: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "'$1' is required: $2"; }

# The suite's own virtualenv if it has one, else the Python on PATH.
python_bin() {
  local suite="${1:-api-tests}"
  for candidate in "$suite/.venv/bin/python" "$suite/.venv/Scripts/python.exe"; do
    [ -x "$candidate" ] && { echo "$ROOT/$candidate"; return; }
  done
  command -v python3 || command -v python || die "Python 3.12+ is required"
}

# Starts the Pages Functions with the Claude stub for the rest of this script,
# and exports where they are.
start_functions() {
  # shellcheck source=/dev/null
  source api-tests/scripts/local-env.sh >/dev/null
  PYTHON="$1" bash api-tests/scripts/start-functions.sh --bg >/dev/null
  trap 'bash api-tests/scripts/start-functions.sh --stop >/dev/null' EXIT
  export FITLOG_FUNCTIONS_URL="http://127.0.0.1:${FUNCTIONS_PORT:-8788}"
  export FITLOG_STUB_URL="http://127.0.0.1:${STUB_PORT:-8790}"
}

stack_running() { npx --no-install supabase status >/dev/null 2>&1; }

stack_up() {
  need docker "install Docker Desktop (or Docker Engine) and start it"
  docker info >/dev/null 2>&1 || die "Docker isn't running; start it and try again"
  need npx "install Node 22+, then run: npm ci"
  [ -d node_modules ] || die "run 'npm ci' first (the Supabase CLI is a dev dependency)"
  npx --no-install supabase start
}

test_unit() {
  need npm "install Node 22+"
  npm test
}

test_api() {
  local py
  py="$(python_bin)"
  "$py" -c 'import pytest_bdd, httpx, psycopg, allure' 2>/dev/null || die "the API suite's packages are missing. Create its environment once:
  python3 -m venv api-tests/.venv && api-tests/.venv/bin/pip install -r api-tests/requirements.txt"
  stack_running || die "the local Supabase stack isn't running: make stack-up"
  start_functions "$py"

  (cd api-tests && "$py" -m pytest -n auto --dist loadgroup \
    --junitxml=../reports/api-junit.xml \
    --alluredir=../reports/allure-results --clean-alluredir "$@")
}

test_ai() {
  local py
  py="$(python_bin ai-evals)"
  "$py" -c 'import testkit, yaml, anthropic' 2>/dev/null || die "the AI evals' packages are missing. Create their environment once (from the repo root):
  python3 -m venv ai-evals/.venv && ai-evals/.venv/bin/pip install -r ai-evals/requirements.txt"
  need node "install Node 22+ (the evals run the app's own trainer code)"
  stack_running || die "the local Supabase stack isn't running: make stack-up"
  start_functions "$py"

  (cd ai-evals && "$py" -m pytest     --junitxml=../reports/ai-evals-junit.xml     --alluredir=../reports/allure-results-ai --clean-alluredir "$@")
}

test_e2e() {
  stack_running || die "the local Supabase stack isn't running: make stack-up"
  docker compose run --rm --build e2e
}

test_security() {
  PYTHON="$(python_bin)" bash scripts/security-scan.sh
}

report() {
  need java "Allure's report builder runs on Java 8+"
  local results=()
  for dir in reports/allure-results reports/allure-results-ai; do
    [ -d "$dir" ] && results+=("$dir")
  done
  [ ${#results[@]} -gt 0 ] || die "no Allure results yet: run make test-api or make test-ai first"
  npx --yes "$ALLURE" generate "${results[@]}" --clean -o reports/allure-report
  echo "Report: reports/allure-report/index.html (serving it now; Ctrl-C to stop)"
  npx --yes "$ALLURE" open reports/allure-report
}

stack_down() {
  bash api-tests/scripts/start-functions.sh --stop >/dev/null 2>&1 || true
  npx --no-install supabase stop
}

command="${1:-}"
shift || true
case "$command" in
  stack-up) stack_up ;;
  test-unit) test_unit ;;
  test-api) test_api "$@" ;;
  test-ai) test_ai "$@" ;;
  test-e2e) test_e2e ;;
  test-security) test_security ;;
  test) stack_up && test_unit && test_api && test_ai && test_e2e ;;
  report) report ;;
  stack-down) stack_down ;;
  *) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; [ -z "$command" ] || exit 1 ;;
esac
