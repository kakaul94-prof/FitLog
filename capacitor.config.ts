import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.fitlog.mobile',
  appName: 'FitLog',
  webDir: 'dist',
  // Live-URL strategy: the app loads the deployed PWA (prod). Pushing to main →
  // Cloudflare redeploy is the update channel; no native rebuild for UI changes.
  server: {
    url: 'https://fitlog-9wl.pages.dev',
    androidScheme: 'https',
  },
};

export default config;
