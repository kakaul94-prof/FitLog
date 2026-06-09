import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { BottomNav } from './BottomNav'

export function AppLayout() {
  // Lift the global rest-timer bar above the bottom nav while these tabbed
  // routes are mounted; full-screen sub-pages clear it so the bar drops to the
  // bottom edge. (Read as `bottom: var(--rest-timer-bottom, 0px)` in the bar.)
  useEffect(() => {
    const el = document.documentElement
    el.style.setProperty(
      '--rest-timer-bottom',
      'calc(4.25rem + env(safe-area-inset-bottom))',
    )
    return () => {
      el.style.removeProperty('--rest-timer-bottom')
    }
  }, [])

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col border-x border-border bg-background">
      <main className="flex-1 pb-[calc(4.25rem+env(safe-area-inset-bottom))]">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
