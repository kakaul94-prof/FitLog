import * as React from 'react'
import { cn } from '@/lib/utils'

/** Pulsing placeholder block shown while data loads (perceived performance). */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  )
}
