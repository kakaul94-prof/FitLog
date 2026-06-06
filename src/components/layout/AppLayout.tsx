import { Outlet } from 'react-router-dom'
import { BottomNav } from './BottomNav'

export function AppLayout() {
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col border-x border-border bg-background">
      <main className="flex-1 pb-[calc(4.25rem+env(safe-area-inset-bottom))]">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
