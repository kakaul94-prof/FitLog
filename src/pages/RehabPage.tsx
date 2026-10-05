import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRehab } from '@/features/rehab/useRehab'
import { usePainFlags } from '@/features/rehab/usePainFlags'
import { useCoachEnabled } from '@/features/profile/useProfile'
import {
  PAIN_SITES,
  activeInjuries,
  injuryDay,
  injuryLabel,
  isPaired,
  painLabel,
  painTrend,
  rehabWeek,
  resolvedInjuries,
  summarizeFlags,
} from '@/lib/rehab'
import type { BodySide, Injury } from '@/lib/database.types'
import { dateLabel, todayISO } from '@/lib/date'
import { cn } from '@/lib/utils'

const SIDES: Exclude<BodySide, null>[] = ['left', 'right', 'both']

export function RehabPage() {
  const nav = useNavigate()
  const today = todayISO()
  const { state, addInjury, isSaving, ready } = useRehab()
  const { data: flags } = usePainFlags(90)
  const coachEnabled = useCoachEnabled()
  const [adding, setAdding] = useState(false)

  const active = activeInjuries(state)
  const resolved = resolvedInjuries(state)
  const sites = useMemo(() => summarizeFlags(flags ?? []), [flags])

  return (
    <div className="flex min-h-svh flex-col pb-[env(safe-area-inset-bottom)]">
      <PageHeader
        title="Rehab"
        left={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => nav('/strength')}
            aria-label="Back"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
        action={
          <Button
            size="icon"
            onClick={() => setAdding((a) => !a)}
            aria-label="Log an injury"
          >
            <Plus className="h-5 w-5" />
          </Button>
        }
      />

      <div className="flex-1 space-y-5 px-4 py-4">
        {!ready && (
          <Card className="border-destructive/40 p-4 text-sm text-destructive">
            The <code className="text-xs">rehab</code> column isn't there yet —
            run <code className="text-xs">migration_rehab.sql</code> in the
            Supabase SQL editor. Until then nothing here will save.
          </Card>
        )}
        {adding && (
          <NewInjuryForm
            busy={isSaving}
            onCancel={() => setAdding(false)}
            onCreate={async (inj) => {
              const id = await addInjury(inj)
              setAdding(false)
              nav(`/rehab/${id}`)
            }}
          />
        )}

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Active
          </h2>
          {active.length === 0 ? (
            <Card className="p-4 text-sm text-muted-foreground">
              Nothing in rehab. Tap + when something starts bothering you — the
              pain you log during workouts shows up below either way.
            </Card>
          ) : (
            <div className="space-y-2">
              {active.map((inj) => (
                <InjuryCard
                  key={inj.id}
                  inj={inj}
                  today={today}
                  log={state.log}
                  checkins={state.checkins}
                  onOpen={() => nav(`/rehab/${inj.id}`)}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              From your lifts
            </h2>
            <span className="text-xs text-muted-foreground">90 days</span>
          </div>
          {!coachEnabled ? (
            <Card className="p-4 text-sm text-muted-foreground">
              Pain is only recorded while the Coach pill is on in a workout.
              Turn it on and the sites you flag mid-set collect here.
            </Card>
          ) : flags === undefined ? (
            <Card className="p-4 text-sm text-muted-foreground">Loading…</Card>
          ) : sites.length === 0 ? (
            <Card className="p-4 text-sm text-muted-foreground">
              No pain flagged in the last 90 days.
            </Card>
          ) : (
            <Card className="divide-y divide-border">
              {sites.map((s) => (
                <div key={s.site} className="flex items-start gap-3 p-3">
                  <span className="mt-0.5 min-w-6 rounded-full bg-destructive/15 px-2 py-0.5 text-center text-xs font-medium text-destructive tabular-nums">
                    {s.count}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{painLabel(s.site)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      Last {dateLabel(s.last.date)} · {s.last.exerciseName}
                    </p>
                    {isPaired(s.site) && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {[
                          s.left && `${s.left} left`,
                          s.right && `${s.right} right`,
                          s.both && `${s.both} both`,
                          s.unknown && `${s.unknown} side not recorded`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </Card>
          )}
        </section>

        {resolved.length > 0 && (
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Resolved
            </h2>
            <Card className="divide-y divide-border">
              {resolved.map((inj) => (
                <button
                  key={inj.id}
                  onClick={() => nav(`/rehab/${inj.id}`)}
                  className="flex w-full items-center gap-2 p-3 text-left"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {injuryLabel(inj)}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    Closed {inj.resolved ? dateLabel(inj.resolved) : '—'} ·{' '}
                    {injuryDay(inj, today)} days
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </Card>
          </section>
        )}

        <p className="pb-2 text-[11px] leading-relaxed text-muted-foreground">
          Not medical advice. Sharp pain, swelling, a joint giving way, numbness,
          night pain, or anything lasting more than two weeks — see a
          professional rather than working around it.
        </p>
      </div>
    </div>
  )
}

function InjuryCard({
  inj,
  today,
  log,
  checkins,
  onOpen,
}: {
  inj: Injury
  today: string
  log: Parameters<typeof rehabWeek>[1]
  checkins: Parameters<typeof painTrend>[0]
  onOpen: () => void
}) {
  const week = rehabWeek(inj, log, today)
  const trend = painTrend(checkins, inj.id)
  return (
    <button
      onClick={onOpen}
      className="w-full rounded-xl border border-border bg-card p-3 text-left text-card-foreground shadow-sm"
    >
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-medium">{injuryLabel(inj)}</span>
          <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 tabular-nums dark:text-amber-400">
            Day {injuryDay(inj, today)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {[
            inj.note,
            trend.latest != null
              ? trend.delta != null && trend.delta !== 0
                ? `pain ${trend.latest}/10, ${trend.delta < 0 ? 'down' : 'up'} from ${trend.first}`
                : `pain ${trend.latest}/10`
              : 'not rated yet',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {inj.plan.length > 0 && (
          <>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div
                className={cn(
                  'h-full rounded-full',
                  week.progress >= 1 ? 'bg-primary' : 'bg-primary/70',
                )}
                style={{ width: `${Math.round(week.progress * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              This week · {week.doneCount} of {week.targetCount} on target
            </p>
          </>
        )}
    </button>
  )
}

function NewInjuryForm({
  busy,
  onCancel,
  onCreate,
}: {
  busy: boolean
  onCancel: () => void
  onCreate: (inj: Omit<Injury, 'id'>) => void
}) {
  const [site, setSite] = useState('shoulder')
  const [side, setSide] = useState<BodySide>('left')
  const [note, setNote] = useState('')
  const [started, setStarted] = useState(todayISO())

  return (
    <Card className="space-y-3 p-4">
      <div>
        <p className="mb-1.5 text-xs text-muted-foreground">Where</p>
        <div className="flex flex-wrap gap-1">
          {PAIN_SITES.map((s) => (
            <button
              key={s}
              onClick={() => {
                setSite(s)
                if (!isPaired(s)) setSide(null)
                else if (side == null) setSide('left')
              }}
              className={cn(
                'rounded-full px-2.5 py-1 text-xs',
                site === s
                  ? 'bg-primary/15 font-medium text-primary'
                  : 'bg-secondary text-muted-foreground',
              )}
            >
              {painLabel(s)}
            </button>
          ))}
        </div>
      </div>

      {isPaired(site) && (
        <div>
          <p className="mb-1.5 text-xs text-muted-foreground">Which side</p>
          <div className="flex gap-1">
            {SIDES.map((s) => (
              <button
                key={s}
                onClick={() => setSide(s)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs capitalize',
                  side === s
                    ? 'bg-primary/15 font-medium text-primary'
                    : 'bg-secondary text-muted-foreground',
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-xs text-muted-foreground">
          What it feels like (optional)
        </p>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Aches on overhead press"
        />
      </div>

      <div>
        <p className="mb-1.5 text-xs text-muted-foreground">Started</p>
        <Input
          type="date"
          value={started}
          max={todayISO()}
          onChange={(e) => setStarted(e.target.value)}
        />
      </div>

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          className="flex-1"
          disabled={busy}
          onClick={() =>
            onCreate({
              site,
              side: isPaired(site) ? side : null,
              note: note.trim() || null,
              started,
              status: 'active',
              resolved: null,
              aggravates: [],
              plan: [],
            })
          }
        >
          {busy ? 'Saving…' : 'Start tracking'}
        </Button>
      </div>
    </Card>
  )
}
