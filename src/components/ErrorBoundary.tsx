import { Component, useEffect, type ReactNode } from 'react'
import { useRouteError } from 'react-router-dom'
import { Button } from '@/components/ui/button'

const RELOAD_KEY = 'fitlog:chunk-reload'
/** Attempts older than this belong to a previous incident, not a reload loop. */
const RETRY_WINDOW_MS = 60_000

/**
 * A failed lazy-route import (e.g. a stale chunk hash after a new deploy is
 * served from the PWA precache) rejects, and React.lazy re-throws it. Without a
 * boundary that bubbles to the root and unmounts the whole app → blank screen.
 * Recovery escalates: first a plain reload (the fresh shell usually fixes it);
 * if the import fails again right away, the reload came back stale too — so we
 * clear the service-worker caches (forcing the next load onto the network) and
 * reload once more; only after that do we show the error card. Attempts are
 * timestamped so a recovery from an earlier deploy in the same long-lived
 * session doesn't block this one.
 */
function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message || ''
  return (
    error.name === 'ChunkLoadError' ||
    /dynamically imported module/i.test(msg) || // Chrome/Firefox
    /Importing a module script failed/i.test(msg) || // Safari / iOS
    /Failed to fetch/i.test(msg)
  )
}

function lastAttempt(): { step: number; at: number } | null {
  try {
    const raw = sessionStorage.getItem(RELOAD_KEY)
    if (!raw) return null
    const [step, at] = raw.split(':').map(Number)
    return Number.isFinite(step) && Number.isFinite(at) ? { step, at } : null
  } catch {
    return null
  }
}

/** 1 = plain reload, 2 = clear caches + reload, 0 = give up (show the card). */
function planRecovery(error: unknown): number {
  if (!isChunkLoadError(error)) return 0
  const prev = lastAttempt()
  if (!prev || Date.now() - prev.at > RETRY_WINDOW_MS) return 1
  return prev.step === 1 ? 2 : 0
}

function executeRecovery(step: number) {
  try {
    sessionStorage.setItem(RELOAD_KEY, `${step}:${Date.now()}`)
  } catch {
    /* ignore */
  }
  const reload = () => window.location.reload()
  if (step < 2) {
    reload()
    return
  }
  const work: Promise<unknown>[] = []
  if ('caches' in window) {
    work.push(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .catch(() => {}),
    )
  }
  if ('serviceWorker' in navigator) {
    work.push(
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((reg) => reg.update().catch(() => {}))))
        .catch(() => {}),
    )
  }
  Promise.all(work).then(reload, reload)
  setTimeout(reload, 4000) // in case the cache/SW calls hang
}

function Spinner() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  )
}

function ErrorCard({ message }: { message: string }) {
  // Manual reload = both auto attempts failed; go straight to the cache-clear
  // variant so the tap has the best chance of actually pulling a fresh build.
  const hardReload = () => {
    try {
      sessionStorage.removeItem(RELOAD_KEY)
    } catch {
      /* ignore */
    }
    executeRecovery(2)
  }
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <p className="text-base font-medium">Something went wrong.</p>
      <p className="max-w-xs text-sm text-muted-foreground">
        The app failed to load this page. Reloading usually fixes it.
      </p>
      <Button onClick={hardReload}>Reload</Button>
      {message && (
        <pre className="max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-left text-xs text-muted-foreground">
          {message}
        </pre>
      )}
    </div>
  )
}

interface State {
  error: Error | null
  recovering: boolean
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, recovering: false }

  static getDerivedStateFromError(error: Error): State {
    return { error, recovering: planRecovery(error) > 0 }
  }

  componentDidCatch(error: Error) {
    const step = planRecovery(error)
    if (step > 0) executeRecovery(step)
  }

  render() {
    if (!this.state.error) return this.props.children
    // Recovery reload is in flight — avoid flashing the error card.
    if (this.state.recovering) return <Spinner />
    return (
      <ErrorCard
        message={
          this.state.error.message
            ? `${this.state.error.name}: ${this.state.error.message}`
            : ''
        }
      />
    )
  }
}

/**
 * Route-level error element for the data router. React Router catches errors
 * thrown while rendering a route — including a failed lazy-chunk import — and
 * routes them here (they don't reach a React error boundary), so the same
 * chunk-load recovery lives here too.
 */
export function RouteErrorElement() {
  const error = useRouteError()
  const step = planRecovery(error)

  useEffect(() => {
    if (step > 0) executeRecovery(step)
  }, [step])

  if (step > 0) return <Spinner />
  const message = error instanceof Error ? `${error.name}: ${error.message}` : ''
  return <ErrorCard message={message} />
}
