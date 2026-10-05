import { useSyncExternalStore } from 'react'
import { onlineManager, useIsMutating } from '@tanstack/react-query'

function useOnline() {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  )
}

// Small floating status pill: shows when offline (writes are queued) or while
// queued writes sync on reconnect. Hidden when online with nothing pending.
// `useIsMutating` counts paused (offline) mutations too, so it doubles as the
// pending count.
export function OfflineIndicator() {
  const online = useOnline()
  const pending = useIsMutating()
  if (online && pending === 0) return null
  const label = !online
    ? pending > 0
      ? `Offline · ${pending} pending`
      : 'Offline'
    : `Syncing ${pending}…`
  return (
    <div className="pointer-events-none fixed left-1/2 top-2 z-[60] -translate-x-1/2">
      <div
        className={`rounded-full px-3 py-1 text-xs font-medium shadow-md ${
          online ? 'bg-card text-foreground' : 'bg-foreground text-background'
        }`}
      >
        {label}
      </div>
    </div>
  )
}
