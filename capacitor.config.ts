import type { CapacitorConfig } from '@capacitor/cli';

// Live-URL strategy: the native app loads the deployed dev site live
// (fitlog-9wl.pages.dev), so web/UI changes ship via the Cloudflare `dev`
// redeploy — no APK rebuild needed. Only native changes require a new APK.
//
// The Android UI tests (.maestro/, android-ui.yml) set CAP_SERVER_URL so the
// APK they build loads a web server on the CI host instead, and the emulator
// never reaches a hosted project. Unset everywhere else, so a normal build is
// exactly what it was.
const serverUrl = process.env.CAP_SERVER_URL || 'https://fitlog-9wl.pages.dev';

const config: CapacitorConfig = {
  appId: 'app.fitlog.mobile',
  appName: 'FitLog',
  webDir: 'dist',
  server: {
    url: serverUrl,
    androidScheme: 'https',
    // Plain http is only ever the test host; this lets the WebView load it.
    cleartext: serverUrl.startsWith('http://'),
  },
};

export default config;
