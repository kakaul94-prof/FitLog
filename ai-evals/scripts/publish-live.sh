#!/usr/bin/env bash
# Appends the newest live run to data/ai-evals.json on the gh-pages branch
# (checked out at $1), where the quality dashboard charts it. Dry runs are
# refused: their numbers come from the stub, not Claude.
#
# Like metrics/publish.sh: a concurrent publish makes the push fail, so on a
# rejected push we reset to the latest gh-pages and re-apply, up to 3 times.
set -euo pipefail

SITE="$(cd "$1" && pwd)" # absolute: it is used again from inside ai-evals/
ROOT="$PWD"
summary=$(ls -d "$ROOT"/reports/ai-evals-live/*/summary.json 2>/dev/null | grep -v -- '-dry/' | tail -n 1 || true)
if [ -z "$summary" ]; then
  echo "ai-evals: no live run to publish"
  exit 0
fi

cd "$SITE"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

for attempt in 1 2 3; do
  git fetch --quiet --depth=1 origin +refs/heads/gh-pages:refs/remotes/origin/gh-pages
  git reset --quiet --hard origin/gh-pages
  (cd "$ROOT/ai-evals" && python -m aievals.report publish "$SITE/data/ai-evals.json" "$summary")
  git add data/ai-evals.json
  git commit --quiet -m "ai-evals: live run ${GITHUB_RUN_ID:-local} on ${GITHUB_REF_NAME:-local}"
  if git push --quiet origin HEAD:gh-pages; then
    echo "ai-evals: published"
    exit 0
  fi
  echo "ai-evals: push rejected (attempt $attempt), retrying"
  sleep $((attempt * 5))
done
echo "::warning::ai-evals: could not publish after 3 attempts"
exit 1
