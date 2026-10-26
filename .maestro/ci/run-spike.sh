#!/usr/bin/env bash
# Spike: runs inside android-emulator-runner once the emulator is booted.
# Installs the test APK, then records what Maestro can see of the WebView in
# both of its modes (native accessibility tree vs. Chrome DevTools) and
# whether it can sign in through each. Every result lands in reports/android.
set -uo pipefail

out=reports/android
mkdir -p "$out/shots" "$out/output"

adb devices
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell getprop ro.build.version.release > "$out/android-version.txt"

run_flow() { # name -> exit code recorded in results.txt, never aborts the spike
  local name=$1
  maestro test ".maestro/spike/$name.yaml" \
    --test-output-dir "$out/output/$name" \
    --debug-output "$out/debug/$name" --flatten-debug-output
  local rc=$?
  echo "$name: exit $rc" | tee -a "$out/results.txt"
  return 0
}

# 1. Open the sign-in screen, then dump the native accessibility hierarchy.
run_flow open-login
maestro hierarchy > "$out/hierarchy-login-native.txt" 2>&1 || true

# 2. Sign in using native-tree selectors (placeholders / visible text).
run_flow login-native
maestro hierarchy > "$out/hierarchy-diary-native.txt" 2>&1 || true

# 3. Sign in using DevTools selectors (HTML ids), from a cleared state.
run_flow login-devtools

# 4. A flow that fails on purpose with DevTools on, so Maestro writes the
#    DevTools view of the diary screen to its screen-hierarchy folder.
run_flow dump-devtools

adb logcat -d -t 2000 > "$out/logcat.txt" 2>&1 || true
echo "---- results ----"; cat "$out/results.txt"

# The spike passes if the DevTools sign-in worked: that is the mode the real
# flows will use. The other results are information.
grep -q '^login-devtools: exit 0$' "$out/results.txt"
