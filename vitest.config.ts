import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

// Standalone from vite.config.ts on purpose: the app's build config pulls in the
// React / Tailwind / PWA plugins, none of which the pure-logic unit tests need.
// Kept minimal so `npm test` stays fast. The `@` alias mirrors the app so tests
// can import either `@/lib/...` or relatively.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
