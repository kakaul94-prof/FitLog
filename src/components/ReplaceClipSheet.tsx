import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { dateLabel, todayISO } from '@/lib/date'
import type { FormClip } from '@/features/strength/useFormVideos'

function fmtSec(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

// Shown when an exercise already holds its max clips: pick which one the new
// clip replaces. Clips arrive newest-first, so the oldest (last) is preselected.
export function ReplaceClipSheet({
  clips,
  pending,
  onConfirm,
  onClose,
}: {
  clips: FormClip[]
  pending: boolean
  onConfirm: (replaceId: string) => void
  onClose: () => void
}) {
  const [pick, setPick] = useState(clips[clips.length - 1]?.row.id)

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50"
      onClick={pending ? undefined : onClose}
    >
      <div
        className="mx-auto w-full max-w-md p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <Card className="space-y-3 p-4 text-foreground">
          <div>
            <p className="font-semibold">Replace a clip?</p>
            <p className="text-sm text-muted-foreground">
              You have {clips.length} clips for this exercise. Pick one to replace.
            </p>
          </div>
          <div className="space-y-2">
            {clips.map((c, i) => (
              <button
                key={c.row.id}
                onClick={() => setPick(c.row.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border p-2 text-left',
                  pick === c.row.id ? 'border-2 border-primary' : 'border-border',
                )}
              >
                <video
                  src={`${c.url}#t=0.1`}
                  preload="metadata"
                  muted
                  playsInline
                  className="h-9 w-14 shrink-0 rounded bg-black object-cover"
                />
                <span className="text-sm">
                  {dateLabel(todayISO(new Date(c.row.created_at)))}
                  {c.row.duration_sec ? ` · ${fmtSec(c.row.duration_sec)}` : ''}
                  {i === clips.length - 1 && (
                    <span className="block text-xs text-muted-foreground">Oldest</span>
                  )}
                </span>
              </button>
            ))}
          </div>
          <Button
            className="w-full"
            disabled={!pick || pending}
            onClick={() => pick && onConfirm(pick)}
          >
            {pending ? 'Saving…' : 'Replace and save'}
          </Button>
          <Button variant="ghost" className="w-full" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </Card>
      </div>
    </div>,
    document.body,
  )
}
