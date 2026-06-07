import { Component, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

const RELOAD_KEY = 'fitlog:chunk-reload'

/**
 * A failed lazy-route import (e.g. a stale chunk hash after a new deploy is
 * served from the PWA precache) rejects, and React.lazy re-throws it. Without a
 * boundary that bubbles to the root and unmounts the whole app → blank screen.
 * Here we catch it: chunk-load failures auto-reload once (so the browser fetches
 * the fresh index.html + chunks), guarded against reload loops; anything else
 * shows a recoverable fallback instead of nothing.
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

const alreadyReloaded = () => {
  try {
    return sessionStorage.getItem(RELOAD_KEY) === '1'
  } catch {
    return false
  }
}

interface State {
  error: Error | null
  reloading: boolean
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, reloading: false }

  static getDerivedStateFromError(error: Error): State {
    return { error, reloading: isChunkLoadError(error) && !alreadyReloaded() }
  }

  componentDidCatch(error: Error) {
    if (isChunkLoadError(error) && !alreadyReloaded()) {
      try {
        sessionStorage.setItem(RELOAD_KEY, '1')
      } catch {
        /* ignore */
      }
      window.location.reload()
    }
  }

  private hardReload = () => {
    try {
      sessionStorage.removeItem(RELOAD_KEY)
    } catch {
      /* ignore */
    }
    window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children

    // Auto-reload is in flight — avoid flashing the error card.
    if (this.state.reloading) {
      return (
        <div className="flex min-h-svh items-center justify-center bg-background">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
        </div>
      )
    }

    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <p className="text-base font-medium">Something went wrong.</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          The app failed to load this page. Reloading usually fixes it.
        </p>
        <Button onClick={this.hardReload}>Reload</Button>
      </div>
    )
  }
}
