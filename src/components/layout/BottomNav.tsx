import { NavLink } from 'react-router-dom'
import {
  NotebookPen,
  Flame,
  Dumbbell,
  TrendingUp,
  MoreHorizontal,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const tabs = [
  { to: '/', label: 'Diary', icon: NotebookPen, end: true },
  { to: '/exercise', label: 'Exercise', icon: Flame, end: false },
  { to: '/strength', label: 'Lift', icon: Dumbbell, end: false },
  { to: '/progress', label: 'Progress', icon: TrendingUp, end: false },
  { to: '/more', label: 'More', icon: MoreHorizontal, end: false },
]

export function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-md -translate-x-1/2 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="grid grid-cols-5">
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )
            }
          >
            <Icon className="h-5 w-5" />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
