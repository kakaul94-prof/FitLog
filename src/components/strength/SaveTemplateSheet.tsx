import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, Check, Timer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { fmtRest, type TemplateDiff, type TemplateRow } from '@/lib/templateDiff'

/**
 * Bottom sheet behind the workout's Done button and its "Save as template"
 * button. With a `diff` it asks "Save changes to <template>?" and shows exactly
 * what Update would write (swaps, set counts, order, rest timer); without one
 * — or after "Save as new template" — it collects a name for a fresh template
 * built from this workout.
 */
export function SaveTemplateSheet({
  routineName,
  diff,
  lifts,
  restSeconds,
  defaultName,
  busy,
  onUpdate,
  onSaveNew,
  onSkip,
  onClose,
}: {
  /** The source template's name; null for an ad-hoc workout. */
  routineName: string | null
  diff: TemplateDiff | null
  lifts: TemplateRow[]
  restSeconds: number
  defaultName: string
  busy: boolean
  onUpdate: () => void
  onSaveNew: (name: string) => void
  /** "Finish without saving" — only offered on the Done path. */
  onSkip?: () => void
  onClose: () => void
}) {
  const [naming, setNaming] = useState(routineName == null || diff == null)
  const [name, setName] = useState(defaultName)

  const body =
    naming || !diff || !routineName ? (
      <>
        <div className="text-base font-semibold">Save as template</div>
        <div className="space-y-1.5">
          <label htmlFor="tpl-name" className="text-xs text-muted-foreground">
            Name
          </label>
          <Input
            id="tpl-name"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Push Day B"
          />
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Includes</div>
          <ul className="divide-y divide-border text-sm">
            {lifts.map((l, i) => (
              <li key={`${l.exercise_key}-${i}`} className="flex justify-between py-1.5">
                <span className="truncate">{l.exercise_name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {l.target_sets} set{l.target_sets === 1 ? '' : 's'}
                  {l.target_reps != null && ` × ${l.target_reps}`}
                </span>
              </li>
            ))}
            <li className="flex justify-between py-1.5">
              <span className="flex items-center gap-1.5">
                <Timer className="h-4 w-4 text-muted-foreground" /> Rest {fmtRest(restSeconds)}
              </span>
              <span className="text-muted-foreground">from this workout</span>
            </li>
          </ul>
        </div>
        <Button
          className="w-full"
          disabled={busy || !name.trim()}
          onClick={() => onSaveNew(name.trim())}
        >
          <Check className="h-4 w-4" /> {busy ? 'Saving…' : 'Save template'}
        </Button>
        <Button
          variant="ghost"
          className="w-full"
          disabled={busy}
          onClick={() => (routineName && diff ? setNaming(false) : onClose())}
        >
          {routineName && diff ? 'Back' : 'Cancel'}
        </Button>
      </>
    ) : (
      <>
        <div className="text-base font-semibold">Save changes to {routineName}?</div>
        <div className="text-xs text-muted-foreground">
          This workout differs from the template.
        </div>
        <ul className="divide-y divide-border text-sm">
          {diff.removed.map((n) => (
            <li key={`r-${n}`} className="flex items-center justify-between py-1.5">
              <span className="truncate">
                <span className="mr-1 text-destructive">−</span>
                {n}
              </span>
              <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                removed
              </span>
            </li>
          ))}
          {diff.added.map((n) => (
            <li key={`a-${n}`} className="flex items-center justify-between py-1.5">
              <span className="truncate">
                <span className="mr-1 text-primary">+</span>
                {n}
              </span>
              <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                added
              </span>
            </li>
          ))}
          {diff.sets.map((s) => (
            <li key={`s-${s.name}`} className="flex items-center justify-between py-1.5">
              <span className="truncate">{s.name}</span>
              <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                {s.from} <ArrowRight className="h-3 w-3" /> {s.to} sets
              </span>
            </li>
          ))}
          {diff.reordered && (
            <li className="py-1.5 text-muted-foreground">Exercise order changed</li>
          )}
          {diff.rest && (
            <li className="flex items-center justify-between py-1.5">
              <span className="flex items-center gap-1.5">
                <Timer className="h-4 w-4 text-muted-foreground" /> Rest between sets
              </span>
              <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                {fmtRest(diff.rest.from)} <ArrowRight className="h-3 w-3" />{' '}
                <span className="font-semibold text-foreground">{fmtRest(diff.rest.to)}</span>
              </span>
            </li>
          )}
        </ul>
        <Button className="w-full" disabled={busy} onClick={onUpdate}>
          <Check className="h-4 w-4" /> {busy ? 'Saving…' : `Update ${routineName}`}
        </Button>
        <Button
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={() => setNaming(true)}
        >
          Save as new template
        </Button>
        {onSkip && (
          <Button variant="ghost" className="w-full" disabled={busy} onClick={onSkip}>
            Finish without saving
          </Button>
        )}
      </>
    )

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50"
      onClick={busy ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Save to template"
        className="mx-auto w-full max-w-md p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <Card className="max-h-[85svh] space-y-3 overflow-y-auto p-4 text-foreground">
          {body}
        </Card>
      </div>
    </div>,
    document.body,
  )
}
