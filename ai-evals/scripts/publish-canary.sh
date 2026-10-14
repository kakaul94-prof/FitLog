#!/usr/bin/env bash
# Appends the newest production-canary run (reports/prod-canary/summary.json,
# plus the alert actions in alerts.json) to data/prod-canary.json on the gh-pages
# branch (checked out at $1), where the quality dashboard charts it.
#
# Like publish-live.sh: a concurrent publish makes the push fail, so on a
# rejected push we reset to the latest gh-pages and re-apply, up to 3 times.
set -euo pipefail

SITE="$(cd "$1" && pwd)"
ROOT="$PWD"
summary="$ROOT/reports/prod-canary/summary.json"
alerts="$ROOT/reports/prod-canary/alerts.json"
if [ ! -f "$summary" ]; then
  echo "canary: no run to publish"
  exit 0
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
  (cd "$ROOT/ai-evals" && python -m aievals.canary publish "$SITE/data/prod-canary.json" "$summary" "${extra[@]}")
  git add data/prod-canary.json
  git commit --quiet -m "canary: run ${GITHUB_RUN_ID:-local}"
  if git push --quiet origin HEAD:gh-pages; then
    echo "canary: published"
    exit 0
  fi
  echo "canary: push rejected (attempt $attempt), retrying"
  sleep $((attempt * 5))
done
echo "::warning::canary: could not publish after 3 attempts"
exit 1
