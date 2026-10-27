import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// Sentry source maps. Only a build that knows which commit it is AND has an
// auth token uploads them (the production deploy job in ci.yml): the maps are
// built hidden (no sourceMappingURL comment), uploaded under the commit SHA
// that shared/release.ts tags events with, and deleted before dist/ ships, so
// users never download them. Everywhere else the plugin is off and the build
// is exactly what it was.
const release = process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA
const uploadSourceMaps = Boolean(
  release && process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
)

// https://vite.dev/config/
export default defineConfig({
  build: { sourcemap: uploadSourceMaps ? 'hidden' : false },
  plugins: [
    react(),
    tailwindcss(),
    sentryVitePlugin({
      disable: !uploadSourceMaps,
      telemetry: false,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: { name: release },
      sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'FitLog',
        short_name: 'FitLog',
        description: 'Track food, macros, workouts & weight.',
        theme_color: '#5a5cd6',
        background_color: '#f6f6fa',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
