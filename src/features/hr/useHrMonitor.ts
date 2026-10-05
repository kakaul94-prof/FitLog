import { useEffect, useState, useSyncExternalStore } from 'react'
import { hrState, subscribeHr, type HrState } from '@/lib/hrWatch'

/** How long a silent strap stays believable before we grey the reading out. */
const STALE_MS = 12000

export interface HrLive extends HrState {
  /** Connected, but nothing has arrived for a while (strap slipped / out of range). */
  stale: boolean
}

/**
 * Live strap readings. The connection itself lives in hrWatch.ts — this only
 * subscribes, plus a 1 Hz tick while connected so staleness can age out on its
 * own without a new reading to trigger the render.
 */
export function useHrMonitor(): HrLive {
  const state = useSyncExternalStore(subscribeHr, hrState, hrState)
  const [, tick] = useState(0)

  useEffect(() => {
    if (state.status !== 'connected') return
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [state.status])

  return {
    ...state,
    stale:
      state.status === 'connected' &&
      state.bpm != null &&
      Date.now() - state.at > STALE_MS,
  }
}
