import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Play, Plus, Square, Timer, Trash2, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useMobility } from '@/features/mobility/useMobility'
import { MOBILITY_EXERCISES } from '@/data/exercises'
import { weekStartISO } from '@/lib/cardio'
import { todayISO } from '@/lib/date'
import { getChime, getNotify, notifyPhone, playChime } from '@/lib/restTimer'
import {
  clockLabel,
  minLabel,
  mobilityWeek,
  stretchWeekByDay,
  type MobilityRow,
} from '@/lib/mobility'
import type { MobilityStretch } from '@/lib/database.types'
import { cn } from '@/lib/utils'

// Mobility list: standing stretches with weekly minute targets that you chip
// away at whenever you have a spare minute, rather than a session to attend.
// Lives in Program → Mobility; state is in profiles.program.mobility.

const DAY_LABEL = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' })

export function MobilitySection() {
  const { state, bank, addStretch, updateStretch, removeStretch } = useMobility()
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const today = todayISO()
  const week = useMemo(() => mobilityWeek(state, today), [state, today])
  const open = week.rows.find((r) => r.stretch.id === openId) ?? null

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">This week</span>
          <span className="text-xs text-muted-foreground">
            Resets Mon · {week.daysLeft} {week.daysLeft === 1 ? 'day' : 'days'} left
          </span>
        </div>
        <div className="mb-2 mt-0.5 flex items-baseline gap-1.5">
          <span className="text-2xl font-medium">
            {Math.round(week.bankedSec / 60)}
          </span>
          <span className="text-sm text-muted-foreground">
            of {Math.round(week.targetSec / 60)} min
          </span>
          {week.doneCount > 0 && (
            <span className="ml-auto text-xs text-muted-foreground">
              {week.doneCount} of {week.rows.length} done
            </span>
          )}
        </div>
        <Bar value={week.progress} className="h-1.5" />
      </Card>

      {week.rows.length > 0 && (
        <Card className="divide-y divide-border overflow-hidden">
          {week.rows.map((row) => (
            <StretchRow
              key={row.stretch.id}
              row={row}
              onOpen={() => setOpenId(row.stretch.id)}
            />
          ))}
        </Card>
      )}

      {week.rows.length === 0 && (
        <Card className="p-6 text-center">
          <Timer className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium">No stretches yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add a stretch with a weekly minute target, then bank time whenever
            you get a minute.
          </p>
        </Card>
      )}

      <button
        onClick={() => setAdding(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium text-primary active:bg-accent"
      >
        <Plus className="h-4 w-4" /> Add stretch
      </button>

      {open && (
        <StretchSheet
          row={open}
          log={state.log}
          today={today}
          onClose={() => setOpenId(null)}
          onBank={(sec) => bank(open.stretch.id, sec)}
          onSave={(patch) => updateStretch(open.stretch.id, patch)}
          onRemove={() => {
            void removeStretch(open.stretch.id)
            setOpenId(null)
          }}
        />
      )}

      {adding && (
        <AddStretchSheet
          onClose={() => setAdding(false)}
          onAdd={(s) => {
            void addStretch(s)
            setAdding(false)
          }}
        />
      )}
    </div>
  )
}

function Bar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-full bg-muted', className ?? 'h-1')}>
      <div
        className="h-full rounded-full bg-primary transition-[width]"
        style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
      />
    </div>
  )
}

function StretchRow({ row, onOpen }: { row: MobilityRow; onOpen: () => void }) {
  const { stretch, banked, target, done } = row
  return (
    <button onClick={onOpen} className="block w-full p-3 text-left active:bg-accent">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="flex-1 text-sm font-medium">{stretch.name}</span>
        <span className="text-xs text-muted-foreground">
          {minLabel(banked)}
          {target > 0 && ` / ${Math.round(target / 60)} min`}
        </span>
        {done ? (
          <Check className="h-4 w-4 text-primary" />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Play className="h-3 w-3" />
          </span>
        )}
      </div>
      <Bar value={row.progress} />
    </button>
  )
}

/** Bottom sheet for one stretch: hold timer, manual entry, week breakdown and
 *  the target editor. */
function StretchSheet({
  row,
  log,
  today,
  onClose,
  onBank,
  onSave,
  onRemove,
}: {
  row: MobilityRow
  log: { id: string; stretchId: string; date: string; seconds: number }[]
  today: string
  onClose: () => void
  onBank: (seconds: number) => void
  onSave: (patch: Partial<Omit<MobilityStretch, 'id'>>) => void
  onRemove: () => void
}) {
  const { stretch, banked, target } = row
  const holdSec = stretch.holdSec ?? null

  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [manual, setManual] = useState('')
  const [editing, setEditing] = useState(false)
  const audioRef = useRef<AudioContext | null>(null)
  const firedRef = useRef(false)

  const byDay = useMemo(
    () => stretchWeekByDay(log, stretch.id, weekStartISO(today)),
    [log, stretch.id, today],
  )

  // Timestamp-driven so a throttled background tab doesn't drift the count.
  useEffect(() => {
    if (startedAt == null) return
    const tick = () => setElapsed((Date.now() - startedAt) / 1000)
    tick()
    const h = window.setInterval(tick, 250)
    return () => window.clearInterval(h)
  }, [startedAt])

  useEffect(
    () => () => {
      void audioRef.current?.close()
    },
    [],
  )

  const finish = (seconds: number) => {
    setStartedAt(null)
    setElapsed(0)
    firedRef.current = false
    if (seconds >= 1) onBank(seconds)
  }

  // Countdown holds bank themselves and alert at zero; count-up waits for Stop.
  useEffect(() => {
    if (startedAt == null || holdSec == null || firedRef.current) return
    if (elapsed < holdSec) return
    firedRef.current = true
    if (audioRef.current) playChime(audioRef.current)
    if (getNotify()) notifyPhone('Hold complete', `${stretch.name} — time's up`)
    finish(holdSec)
    // finish() resets the timer; deps cover every value it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, startedAt, holdSec, stretch.name])

  const start = () => {
    // Build the AudioContext inside the tap: iOS won't allow it later.
    if (holdSec != null && getChime() && !audioRef.current) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      if (Ctx) {
        const ctx = new Ctx()
        if (ctx.state === 'suspended') void ctx.resume()
        audioRef.current = ctx
      }
    }
    firedRef.current = false
    setElapsed(0)
    setStartedAt(Date.now())
  }

  const running = startedAt != null
  const remaining = holdSec != null ? Math.max(0, holdSec - elapsed) : 0
  const addManual = () => {
    const min = parseFloat(manual)
    if (!Number.isFinite(min) || min <= 0) return
    onBank(Math.round(min * 60))
    setManual('')
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        className="mx-auto w-full max-w-md p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <Card className="overflow-hidden">
          <div className="flex items-center border-b border-border p-3">
            <span className="w-8" />
            <div className="flex-1 text-center">
              <div className="text-sm font-medium">{stretch.name}</div>
              <div className="text-xs text-muted-foreground">
                {minLabel(banked)}
                {target > 0 && ` of ${Math.round(target / 60)} min`} banked this week
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center text-muted-foreground active:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-3 p-3">
            <div className="rounded-xl bg-accent/60 p-4 text-center">
              <div className="text-4xl font-medium tabular-nums">
                {clockLabel(holdSec != null && running ? remaining : elapsed)}
              </div>
              <div className="mb-3 text-xs text-muted-foreground">
                {running
                  ? 'Holding'
                  : holdSec != null
                    ? `${holdSec}s hold`
                    : 'Open-ended — stop when you are done'}
              </div>
              {running ? (
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => finish(Math.round(elapsed))}>
                    <Square className="mr-1.5 h-4 w-4" /> Stop and bank
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label="Discard"
                    onClick={() => finish(0)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <Button className="w-full" onClick={start}>
                  <Play className="mr-1.5 h-4 w-4" /> Start
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="whitespace-nowrap text-sm text-muted-foreground">
                Or add
              </span>
              <Input
                className="h-9 flex-1"
                type="number"
                inputMode="decimal"
                placeholder="2"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
              />
              <span className="text-sm text-muted-foreground">min</span>
              <Button variant="outline" onClick={addManual} disabled={!manual}>
                Add
              </Button>
            </div>

            {byDay.length > 0 && (
              <div className="border-t border-border pt-2">
                <div className="mb-1 text-xs text-muted-foreground">This week</div>
                {byDay.map((d) => (
                  <div key={d.date} className="flex justify-between py-0.5 text-sm">
                    <span className="text-muted-foreground">{DAY_LABEL(d.date)}</span>
                    <span>{minLabel(d.seconds)}</span>
                  </div>
                ))}
              </div>
            )}

            {editing ? (
              <StretchFields
                initial={stretch}
                onCancel={() => setEditing(false)}
                onSave={(patch) => {
                  onSave(patch)
                  setEditing(false)
                }}
                onRemove={onRemove}
              />
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="w-full rounded-md py-2 text-xs font-medium text-muted-foreground active:bg-accent"
              >
                Edit target
              </button>
            )}
          </div>
        </Card>
      </div>
    </div>,
    document.body,
  )
}

/** Name / weekly target / hold-length fields, shared by add and edit. */
function StretchFields({
  initial,
  onSave,
  onCancel,
  onRemove,
}: {
  initial?: MobilityStretch
  onSave: (patch: Omit<MobilityStretch, 'id'>) => void
  onCancel: () => void
  onRemove?: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [targetMin, setTargetMin] = useState(String(initial?.targetMin ?? 5))
  const [hold, setHold] = useState(
    initial?.holdSec != null ? String(initial.holdSec) : '',
  )

  const save = () => {
    const n = name.trim()
    const t = parseFloat(targetMin)
    if (!n || !Number.isFinite(t) || t <= 0) return
    const h = parseInt(hold)
    onSave({
      name: n,
      targetMin: t,
      holdSec: Number.isFinite(h) && h > 0 ? h : null,
    })
  }

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <div className="space-y-1.5">
        <Label htmlFor="mname">Name</Label>
        <Input
          id="mname"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Horse stance"
        />
        {!initial && (
          <div className="flex flex-wrap gap-1 pt-1">
            {MOBILITY_EXERCISES.slice(0, 8).map((e) => (
              <button
                key={e.key}
                onClick={() => setName(e.name)}
                className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground active:bg-accent"
              >
                {e.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="mtarget">Weekly target (min)</Label>
          <Input
            id="mtarget"
            type="number"
            inputMode="decimal"
            value={targetMin}
            onChange={(e) => setTargetMin(e.target.value)}
          />
        </div>
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="mhold">Hold (sec)</Label>
          <Input
            id="mhold"
            type="number"
            inputMode="numeric"
            placeholder="Optional"
            value={hold}
            onChange={(e) => setHold(e.target.value)}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Set a hold and the timer counts down and chimes at zero. Leave it blank
        to count up until you stop.
      </p>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={save} disabled={!name.trim()}>
          Save
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {onRemove && (
          <Button
            variant="ghost"
            aria-label="Remove stretch"
            onClick={onRemove}
            className="text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

function AddStretchSheet({
  onClose,
  onAdd,
}: {
  onClose: () => void
  onAdd: (s: Omit<MobilityStretch, 'id'>) => void
}) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        className="mx-auto w-full max-w-md p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <Card className="overflow-hidden">
          <div className="flex items-center border-b border-border p-3">
            <span className="w-8" />
            <span className="flex-1 text-center text-sm font-medium">Add stretch</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center text-muted-foreground active:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="p-3">
            <StretchFields onSave={onAdd} onCancel={onClose} />
          </div>
        </Card>
      </div>
    </div>,
    document.body,
  )
}
