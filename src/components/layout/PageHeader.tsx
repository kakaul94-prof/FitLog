import type { ReactNode } from 'react'

export function PageHeader({
  title,
  subtitle,
  action,
  left,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  left?: ReactNode
}) {
  return (
    <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-background/95 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur">
      {left && <div className="shrink-0">{left}</div>}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-semibold">{title}</h1>
        {subtitle && (
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  )
}
