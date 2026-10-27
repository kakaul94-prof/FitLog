#!/usr/bin/env bash
# One command for a local run: point at the local stack, start the app, run the suite, stop the app.
#
#   bash e2e-java/scripts/run.sh                      # everything
#   bash e2e-java/scripts/run.sh -Dgroups=smoke       # extra args go to Maven
#   HEADLESS=true BROWSER=firefox bash e2e-java/scripts/run.sh
#
# Needs: Docker (the local Supabase stack, `npm run db:start`), Node (the dev server), Java 17.
# Maven itself is downloaded by the wrapper on first use.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
started_app=0

# shellcheck source=start-app.sh
if [ ! -f "$HERE/../app.pid" ]; then started_app=1; fi
source "$HERE/start-app.sh"

cleanup() {
  if [ "$started_app" = 1 ]; then bash "$HERE/stop-app.sh"; fi
}
trap cleanup EXIT

cd "$HERE/.."
./mvnw -B test "$@"
