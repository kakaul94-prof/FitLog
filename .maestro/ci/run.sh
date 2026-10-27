#!/usr/bin/env bash
# Runs the Maestro flows against a booted emulator: android-ui.yml calls it
# inside android-emulator-runner, and it works by hand the same way
# (.maestro/README.md). Retries are off: a flow that passes only on its
# second try is a failure.
#
#   bash .maestro/ci/run.sh             # every flow once
#   REPEAT=5 bash .maestro/ci/run.sh    # the whole set 5 times in a row
#
# Needs: adb on PATH with one device, maestro on PATH, the test APK built,
# the web build served on the host's port $WEB_PORT, and the MAESTRO_*
# variables (.maestro/README.md).
set -uo pipefail

apk=${APK:-android/app/build/outputs/apk/debug/app-debug.apk}
out=${OUT:-reports/android}
repeat=${REPEAT:-1}
web_port=${WEB_PORT:-5174}

mkdir -p "$out"
adb install -r "$apk"
# The test APK loads http://localhost:$web_port. adb reverse makes the
# emulator's localhost reach the host's web server; localhost also counts as
# a secure context, which the app needs (crypto.randomUUID).
adb reverse "tcp:$web_port" "tcp:$web_port"
# Start online, whatever a previous run left behind.
adb shell cmd connectivity airplane-mode disable || true

status=0
for i in $(seq 1 "$repeat"); do
  echo "::group::Flow set, run $i of $repeat"
  maestro test .maestro \
    --format junit --output "$out/run-$i/report.xml" \
    --test-output-dir "$out/run-$i/output" \
    --debug-output "$out/run-$i/debug" --flatten-debug-output || status=1
  echo "::endgroup::"
done

adb logcat -d > "$out/logcat.txt" 2>&1 || true

# Android logs every kill of the app's process. "remove task" means a launch
# landed in a task that was still being removed (subflows/sign-in.yaml):
# report it even when the flow happened to pass.
races=$(grep -rh "Killing [0-9]*:app.fitlog.mobile.*remove task" "$out"/run-*/debug "$out/logcat.txt" 2>/dev/null | sort -u)
echo "Launches killed by task removal: $(printf '%s' "$races" | grep -c . || true)"
[ -n "$races" ] && printf '%s\n' "$races"

exit $status
