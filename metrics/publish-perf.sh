#!/usr/bin/env bash
# Publishes a perf run to the dashboard: appends reports/perf/run.json to
# data/perf.json on the gh-pages branch (checked out at $1) and refreshes the
# dashboard files beside it, so the Performance section is there from the
# first published run.
#
# Like metrics/publish.sh: a concurrent publish makes the push fail, so on a
# rejected push we reset to the latest gh-pages and re-apply, up to 3 times.
set -euo pipefail

SITE="$1"
ROOT="$PWD"
[ -f "$ROOT/reports/perf/run.json" ] || { echo "perf: no run.json to publish (run metrics/perf-summary.mjs first)"; exit 0; }

cd "$SITE"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

for attempt in 1 2 3; do
  git fetch --quiet --depth=1 origin +refs/heads/gh-pages:refs/remotes/origin/gh-pages
  git reset --quiet --hard origin/gh-pages
  mkdir -p data
  cp "$ROOT"/metrics/dashboard/* .
  touch .nojekyll
  node "$ROOT/metrics/append-perf.mjs" "$ROOT/reports/perf/run.json" data/perf.json
  git add -A
  git commit --quiet -m "perf: ${GITHUB_SHA:0:7} on ${GITHUB_REF_NAME:-local}"
  if git push --quiet origin HEAD:gh-pages; then
    echo "perf: published"
    exit 0
  fi
  echo "perf: push rejected (attempt $attempt), retrying"
  sleep $((attempt * 5))
done
echo "::warning::perf: could not publish after 3 attempts"
exit 1
