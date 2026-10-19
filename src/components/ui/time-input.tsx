import * as React from 'react'
import { hhmmLabel } from '@/lib/date'
import { cn } from '@/lib/utils'

// A native <input type="time"> draws its value in the phone's locale, so a
// 24h locale shows "13:19". Show our own 12-hour label instead and lay the
// native input over it, invisible, so a tap still opens the system picker.
export function TimeInput({
  value,
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value'> & { value: string }) {
  return (
    <span
      className={cn(
        'relative inline-block overflow-hidden tabular-nums focus-within:ring-2 focus-within:ring-ring has-[:disabled]:opacity-50',
        className,
      )}
    >
      {value ? hhmmLabel(value) : '--:--'}
      <input
        type="time"
        value={value}
        {...props}
        className="absolute inset-0 h-full w-full min-w-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
    </span>
  )
}
