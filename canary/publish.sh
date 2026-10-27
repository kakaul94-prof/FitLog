#!/usr/bin/env bash
# Appends this canary run (reports/app-canary/summary.json, plus what the alert
# step did in alerts.json) to data/app-canary.json on the gh-pages branch
# (checked out at $1), where the quality dashboard charts uptime and latency.
#
# Like metrics/publish.sh: a concurrent publish makes the push fail, so on a
# rejected push we reset to the latest gh-pages and re-apply, up to 3 times.
set -euo pipefail

SITE="$(cd "$1" && pwd)"
ROOT="$PWD"
summary="$ROOT/reports/app-canary/summary.json"
alerts="$ROOT/reports/app-canary/alerts.json"
if [ ! -f "$summary" ]; then
  echo "::error::app-canary: no summary to publish ($summary)"
  exit 1
fi
extra=()
[ -f "$alerts" ] && extra=(--alerts "$alerts")

cd "$SITE"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

for attempt in 1 2 3; do
  git fetch --quiet --depth=1 origin +refs/heads/gh-pages:refs/remotes/origin/gh-pages
  git reset --quiet --hard origin/gh-pages
  mkdir -p data
  node "$ROOT/canary/append.mjs" "$summary" "$SITE/data/app-canary.json" "${extra[@]}"
  git add data/app-canary.json
  git commit --quiet -m "app-canary: run ${GITHUB_RUN_ID:-local}"
  if git push --quiet origin HEAD:gh-pages; then
    echo "app-canary: published"
    exit 0
  fi
  echo "app-canary: push rejected (attempt $attempt), retrying"
  sleep $((attempt * 5))
done
echo "::warning::app-canary: could not publish after 3 attempts"
exit 1
