// Error tracking (Sentry) for the browser build.
//
// On only in a production build that was given a DSN: the deployed sites,
// where VITE_SENTRY_DSN is a Cloudflare Pages build variable. `npm run dev`,
// Vitest, the Playwright E2E server (a dev server) and every CI build have no
// DSN and are not production builds, so no test run can send an event, even
// from a laptop with a copied .env.
//
// Privacy first (shared/scrub.ts): no request bodies, query strings, cookies,
// auth headers or user object ever leave the app; emails, tokens, food and
// body quantities are redacted from everything else. No tracing, no session
// replay: errors only, every one of them, which for one user's app is a few a
// month against Sentry's free 5,000, with a per-page-load cap so a render loop
// cannot spend the quota either.
import * as Sentry from '@sentry/react'
import { Capacitor } from '@capacitor/core'
import { RELEASE } from '../../shared/release'
import { scrubBreadcrumb, scrubEvent } from '../../shared/scrub'

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
const environment = (import.meta.env.VITE_SENTRY_ENV as string | undefined) || 'production'

export const monitoringEnabled = Boolean(dsn) && import.meta.env.PROD && !import.meta.env.DEV && import.meta.env.MODE === 'production'

const MAX_EVENTS_PER_LOAD = 20
let sent = 0

export function initMonitoring(): void {
  if (!monitoringEnabled) return
  Sentry.init({
    dsn,
    release: RELEASE,
    environment,
    sampleRate: 1,
    tracesSampleRate: 0,
    maxBreadcrumbs: 30,
    // Release-health sessions add traffic and tell an app with one user nothing.
    integrations: (defaults) => defaults.filter((i) => i.name !== 'BrowserSession'),
    ignoreErrors: [
      // Offline and flaky-network noise the app already handles (offline queue, retries).
      /^(TypeError: )?Failed to fetch$/,
      /NetworkError when attempting to fetch/,
      /^(TypeError: )?Load failed$/,
      /The operation was aborted/,
      /AbortError/,
      /ResizeObserver loop/,
    ],
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
    beforeSend: (event) => (sent++ >= MAX_EVENTS_PER_LOAD ? null : scrubEvent(event)),
    initialScope: { tags: { runtime: 'browser', platform: Capacitor.getPlatform() } },
  })

  // For proving the pipeline on a deployed build, from a devtools console:
  // window.__fitlog.testError(). The message carries a fake email and a weight
  // so the event in Sentry shows them scrubbed. Reachable only by someone
  // already at a console; changes nothing a user can see.
  const g = globalThis as unknown as { __fitlog?: Record<string, unknown> }
  g.__fitlog = {
    ...g.__fitlog,
    testError: () =>
      Sentry.captureException(new Error(`FitLog monitoring test (${RELEASE}) from fake.user@example.com weighing 182.4 lb`), {
        tags: { test: 'true' },
      }),
  }
}

/** Report an error the app caught itself (an error boundary). A no-op when monitoring is off. */
export function reportError(error: unknown, tags: Record<string, string> = {}): void {
  if (!monitoringEnabled) return
  Sentry.captureException(toError(error), { tags })
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error
  if (error && typeof error === 'object' && 'status' in error) {
    const { status, statusText } = error as { status?: unknown; statusText?: unknown }
    return new Error(`Route error ${String(status)} ${String(statusText ?? '')}`.trim())
  }
  return new Error(typeof error === 'string' ? error : 'Unknown error')
}
