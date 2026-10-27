// Dev-server config for the Java suite's runs (scripts/start-app.sh). It is the app's own
// vite.config.ts unchanged, plus two server settings that keep the app under test still:
//
// - hmr: false. No live-reload socket, so nothing can reload a page in the middle of a test.
// - watch.ignored. While the suite runs it writes Allure attachments (.html files) under
//   e2e-java/target, inside Vite's root. Vite answers any .html change with a full page reload
//   of every connected browser, i.e. every parallel test at once.
//
// Nothing here changes what the app does; it only changes how the dev server serves it.
import { mergeConfig } from 'vite'
import appConfig from '../vite.config'

export default mergeConfig(appConfig, {
  server: {
    hmr: false,
    watch: {
      ignored: ['**/e2e-java/**', '**/playwright-report/**', '**/test-results/**', '**/reports/**'],
    },
  },
})
