#!/usr/bin/env bash
# Publishes this run to the dashboard: appends reports/run.json to
# data/history.json on the gh-pages branch (checked out at $1) and refreshes the
# dashboard files beside it. GitHub Pages serves that branch, so the branch is
# both the database and the website — no server, no paid service.
#
# Two runs (say dev and main) can publish at the same moment. Both edit the same
# file, so a rebase would conflict; instead, on a rejected push we reset to the
# latest gh-pages and re-apply our one record, up to 3 times.
set -euo pipefail

SITE="$1"
ROOT="$PWD"

cd "$SITE"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

for attempt in 1 2 3; do
  git fetch --quiet --depth=1 origin +refs/heads/gh-pages:refs/remotes/origin/gh-pages
  git reset --quiet --hard origin/gh-pages
  mkdir -p data
  cp "$ROOT"/metrics/dashboard/* .
  touch .nojekyll # serve files as-is, skip GitHub's Jekyll build
  node "$ROOT/metrics/append-history.mjs" "$ROOT/reports/run.json" data/history.json
  git add -A
  git commit --quiet -m "metrics: ${GITHUB_SHA:0:7} on ${GITHUB_REF_NAME}"
  if git push --quiet origin HEAD:gh-pages; then
    echo "metrics: published"
    exit 0
  fi
  echo "metrics: push rejected (attempt $attempt), retrying"
  sleep $((attempt * 5))
done
echo "::warning::metrics: could not publish after 3 attempts"
exit 1
