import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.fitlog.mobile',
  appName: 'FitLog',
  webDir: 'dist',
  // Live-URL strategy: the native app loads the deployed dev site live
  // (fitlog-9wl.pages.dev), so web/UI changes ship via the Cloudflare `dev`
  // redeploy — no APK rebuild needed. Only native changes require a new APK.
  server: {
    url: 'https://fitlog-9wl.pages.dev',
    androidScheme: 'https',
  },
};

export default config;
