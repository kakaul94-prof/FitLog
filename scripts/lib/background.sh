# Background processes that can be stopped together with everything they spawn.
# Sourced by api-tests/scripts/start-functions.sh and scripts/security-scan.sh.
#
# wrangler runs as npx -> node -> node -> workerd, so killing the process we
# started leaves workerd serving the port (and, on Windows, locking files in
# node_modules). So: start each command in its own process group, and stop the
# whole group, or the whole Windows process tree under Git Bash.

# start_bg <logfile> <command...>   Starts it; the pid is in $BG_PID.
start_bg() {
  local log=$1
  shift
  if command -v setsid >/dev/null 2>&1; then
    setsid "$@" >"$log" 2>&1 &
  else
    "$@" >"$log" 2>&1 &
  fi
  BG_PID=$!
}

# stop_tree <pid>   Stops the process and everything under it. Never fails.
stop_tree() {
  local pid=$1
  if [ -r "/proc/$pid/winpid" ] && command -v taskkill >/dev/null 2>&1; then
    taskkill //F //T //PID "$(cat "/proc/$pid/winpid")" >/dev/null 2>&1 || true
  else
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  fi
}
