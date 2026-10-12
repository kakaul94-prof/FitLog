#!/usr/bin/env bash
# Security scans, report-only: secrets in the git history, known-vulnerable
# dependencies, and an OWASP ZAP baseline scan of the built app served the way
# Cloudflare serves it. Reports land in reports/security/ with a summary at the
# end (also written to the CI job summary).
#
#   bash scripts/security-scan.sh          (or: make test-security)
#
# Needs Docker (gitleaks and ZAP run in containers), Node, and Python with the
# API suite's requirements installed (for pip-audit). Findings never fail the
# script: the scans inform, the test suites gate releases.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/reports/security"
PYTHON="${PYTHON:-python}"
APP_PORT="${APP_PORT:-8789}"
GITLEAKS_IMAGE="zricethezav/gitleaks:v8.30.0"
ZAP_IMAGE="ghcr.io/zaproxy/zaproxy:2.17.0"

for tool in docker npx "$PYTHON"; do
  command -v "$tool" >/dev/null || { echo "security-scan: '$tool' is required" >&2; exit 1; }
done
docker info >/dev/null 2>&1 || { echo "security-scan: Docker isn't running" >&2; exit 1; }

# Docker on Windows (Git Bash) wants D:/... paths and no MSYS path rewriting.
host_path() { if command -v cygpath >/dev/null; then cygpath -m "$1"; else echo "$1"; fi; }
export MSYS_NO_PATHCONV=1

mkdir -p "$OUT"
chmod a+w "$OUT" # ZAP's container user writes its reports here
cd "$ROOT"

echo "== 1/4 Secrets: gitleaks"
if [ -d "$ROOT/.git" ]; then
  # Every commit on every branch: a secret deleted later is still leaked.
  scan=(git /repo --log-opts=--all)
else
  # A git worktree's .git is a pointer the container can't follow; scan the files.
  echo "   (git worktree: scanning the working tree, not the history)"
  scan=(dir /repo)
fi
docker run --rm -v "$(host_path "$ROOT"):/repo:ro" -v "$(host_path "$OUT"):/out" \
  "$GITLEAKS_IMAGE" "${scan[@]}" --config /repo/.gitleaks.toml --redact \
  --report-format json --report-path /out/gitleaks.json --exit-code 0 --no-banner

echo "== 2/4 Node dependencies: npm audit"
npm audit --json >"$OUT/npm-audit.json" || true # exits 1 when it finds anything

echo "== 3/4 Python dependencies: pip-audit"
"$PYTHON" -m pip_audit -r api-tests/requirements.txt -f json -o "$OUT/pip-audit.json" ||
  true # exits 1 when it finds anything

echo "== 4/4 Running app: OWASP ZAP baseline"
if [ ! -d dist ]; then
  # Only the static app and its headers are scanned, so dummy settings do.
  VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-https://example.supabase.co}" \
    VITE_SUPABASE_ANON_KEY="${VITE_SUPABASE_ANON_KEY:-dummy-anon-key}" npm run build
fi
# wrangler serves dist/ with public/_headers and _redirects applied, like Pages.
WRANGLER_SEND_METRICS=false npx --no-install wrangler pages dev dist \
  --ip 127.0.0.1 --port "$APP_PORT" --compatibility-date 2025-01-01 \
  >"$OUT/app-server.log" 2>&1 &
server=$!
trap 'kill $server 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$APP_PORT/" >/dev/null && break; sleep 1; done

if [ "$(uname -s)" = "Linux" ]; then
  network=(--network host) target="http://127.0.0.1:$APP_PORT"
else
  network=() target="http://host.docker.internal:$APP_PORT" # Docker Desktop
fi
# -I: report warnings without failing. Passive checks only (headers, cookies,
# leaked info in pages); the baseline never attacks the app.
docker run --rm "${network[@]}" -v "$(host_path "$OUT"):/zap/wrk:rw" "$ZAP_IMAGE" \
  zap-baseline.py -t "$target" -J zap.json -r zap.html -I >"$OUT/zap.log" 2>&1 ||
  echo "   ZAP did not finish; see reports/security/zap.log"

echo
node metrics/security-summary.mjs "$OUT"
