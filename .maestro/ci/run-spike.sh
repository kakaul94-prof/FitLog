#!/usr/bin/env bash
# Spike: runs inside android-emulator-runner once the emulator is booted.
# Installs the test APK, runs the native-mode probe flow, and keeps every
# screenshot, hierarchy and log in reports/android for the artifact.
set -uo pipefail

out=reports/android
mkdir -p "$out/shots"

adb devices
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
# The page loads from the emulator's own localhost (a secure context, which
# crypto.randomUUID needs), tunnelled over adb to the runner's web server.
# Supabase stays on 10.0.2.2, the emulated network, so airplane mode cuts it.
adb reverse tcp:5174 tcp:5174
adb reverse --list
echo "Android $(adb shell getprop ro.build.version.release), WebView: $(adb shell dumpsys webviewupdate | grep -m1 'Current WebView package')"

start=$(date +%s)
maestro test .maestro/spike/probe-native.yaml \
  --test-output-dir "$out/output" \
  --debug-output "$out/debug" --flatten-debug-output \
  --format junit --output "$out/report.xml"
rc=$?
echo "probe-native: exit $rc in $(( $(date +%s) - start ))s" | tee "$out/results.txt"

adb logcat -d > "$out/logcat.txt" 2>&1 || true
echo "---- app process deaths ----"
grep -E "Killing [0-9]+:app.fitlog.mobile|app.fitlog.mobile.*has died|FATAL" "$out/logcat.txt" || echo "none"
echo "---- WebView console ----"
grep -E "Capacitor/Console" "$out/logcat.txt" | tail -40 || true

exit $rc
