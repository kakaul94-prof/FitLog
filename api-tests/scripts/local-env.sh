#!/usr/bin/env bash
# Exports the local Supabase stack's URLs and keys for the API tests.
#
#   source api-tests/scripts/local-env.sh      # local shell (Git Bash, macOS, Linux)
#   bash api-tests/scripts/local-env.sh        # in GitHub Actions: writes to $GITHUB_ENV
#
# The values come from the running stack (`supabase status`), never from the
# repo. They are the CLI's local-development values, but the suite still reads
# them from the environment so no key is ever written into a test file.

if command -v supabase >/dev/null 2>&1; then
  supabase_cli=(supabase)
else
  supabase_cli=(npx --no-install supabase)
fi

env_lines=$("${supabase_cli[@]}" status -o env \
  --override-name api.url=SUPABASE_URL \
  --override-name auth.anon_key=SUPABASE_ANON_KEY \
  --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY \
  --override-name auth.jwt_secret=SUPABASE_JWT_SECRET \
  --override-name db.url=SUPABASE_DB_URL 2>/dev/null |
  grep -E '^SUPABASE_[A-Z_]+=' | tr -d '"')

if [ -z "$env_lines" ]; then
  echo "local-env: is the stack running? Start it with: npm run db:start" >&2
  return 1 2>/dev/null || exit 1
fi

if [ -n "${GITHUB_ENV:-}" ]; then
  echo "$env_lines" >>"$GITHUB_ENV"
  # Keep the keys out of the job log even though they're local-only values.
  echo "$env_lines" | grep -E '_KEY=|_SECRET=' | cut -d= -f2- | sed 's/^/::add-mask::/'
else
  while IFS= read -r line; do export "${line?}"; done <<<"$env_lines"
  echo "local-env: exported $(echo "$env_lines" | cut -d= -f1 | tr '\n' ' ')"
fi
