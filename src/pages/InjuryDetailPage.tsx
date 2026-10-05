import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Check, ChevronLeft, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { LineChartSvg } from '@/components/LineChartSvg'
import { Card } from '@/components/ui/card'
import { RehabPicker } from '@/components/RehabPicker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRehab } from '@/features/rehab/useRehab'
import { usePainFlags } from '@/features/rehab/usePainFlags'
import { useCustomExercises } from '@/features/strength/useCustomExercises'
import { EXERCISES } from '@/data/exercises'
import {
  checkinsFor,
  flagsForInjury,
  injuryDay,
  injuryLabel,
  painTrend,
  rehabWeek,
} from '@/lib/rehab'
import { dateLabel, todayISO } from '@/lib/date'
import { cn } from '@/lib/utils'

const PAIN_COLOR = '#ef4444'

export function InjuryDetailPage() {
  const nav = useNavigate()
  const { id } = useParams<{ id: string }>()
  const today = todayISO()
  const {
    state,
    isSaving,
    addPlanItem,
    addPlanItems,
    removePlanItem,
    logItem,
    unlogItem,
    checkIn,
    resolveInjury,
    reopenInjury,
    removeInjury,
    toggleAggravates,
  } = useRehab()
  const { data: flags } = usePainFlags(90)
  const { data: custom } = useCustomExercises()
  const [addingItem, setAddingItem] = useState(false)
  const [pickingLift, setPickingLift] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const inj = state.injuries.find((i) => i.id === id)

  const week = useMemo(
    () => (inj ? rehabWeek(inj, state.log, today) : null),
    [inj, state.log, today],
  )
  const trend = useMemo(
    () => (inj ? painTrend(state.checkins, inj.id) : null),
    [inj, state.checkins],
  )
  const myFlags = useMemo(
    () => (inj ? flagsForInjury(flags ?? [], inj, today) : []),
    [flags, inj, today],
  )
  const todayRating = inj
    ? (checkinsFor(state.checkins, inj.id).find((c) => c.date === today)?.pain ??
      null)
    : null

  // What's already in the plan, so the picker can grey those rows out.
  const planKeys = useMemo(
    () =>
      new Set(
        (inj?.plan ?? []).map((p) => p.key ?? p.name.toLowerCase()),
      ),
    [inj],
  )

  // Lifts worth offering as "aggravates": ones that have already flagged this
  // site, then the rest of the library.
  const liftOptions = useMemo(() => {
    const all = [
      ...EXERCISES.map((e) => ({ key: e.key, name: e.name })),
      ...(custom ?? []).map((c) => ({ key: `custom:${c.id}`, name: c.name })),
    ]
    const flagged = new Set(myFlags.map((f) => f.exerciseKey))
    return [
      ...all.filter((e) => flagged.has(e.key)),
      ...all.filter((e) => !flagged.has(e.key)),
    ]
  }, [custom, myFlags])

  if (!inj)
    return (
      <div className="flex min-h-svh flex-col pb-[env(safe-area-inset-bottom)]">
        <PageHeader
          title="Rehab"
          left={
            <Button
              variant="ghost"
              size="icon"
              onClick={() => nav('/rehab')}
              aria-label="Back"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          }
        />
        <p className="p-4 text-sm text-muted-foreground">
          That injury is no longer here.
        </p>
      </div>
    )

  const resolved = inj.status === 'resolved'

  return (
    <div className="flex min-h-svh flex-col pb-[env(safe-area-inset-bottom)]">
      <PageHeader
        title={injuryLabel(inj)}
        subtitle={
          resolved
            ? `Closed ${inj.resolved ? dateLabel(inj.resolved) : ''} · ran ${injuryDay(inj, today)} days`
            : `Day ${injuryDay(inj, today)} · started ${dateLabel(inj.started)}`
        }
        left={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => nav('/rehab')}
            aria-label="Back"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />

      <div className="flex-1 space-y-5 px-4 py-4">
        {inj.note && <p className="text-sm text-muted-foreground">{inj.note}</p>}

        {/* Pain trend — the only thing that answers "is this getting better?" */}
        <section>
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Pain trend
            </h2>
            {trend && trend.delta != null && (
              <span
                className={cn(
                  'text-xs',
                  trend.delta < 0
                    ? 'text-primary'
                    : trend.delta > 0
                      ? 'text-destructive'
                      : 'text-muted-foreground',
                )}
              >
                {trend.first} → {trend.latest} over {trend.days} days
              </span>
            )}
          </div>
          {trend && trend.points.length >= 2 ? (
            <Card className="p-2">
              <LineChartSvg
                height={160}
                xKey="d"
                data={trend.points.map((c) => ({
                  d: c.date.slice(5),
                  pain: c.pain,
                }))}
                series={[
                  { key: 'pain', color: PAIN_COLOR, dotRadius: 3, name: 'Pain' },
                ]}
              />
            </Card>
          ) : (
            <Card className="p-4 text-sm text-muted-foreground">
              {trend && trend.points.length === 1
                ? `Rated ${trend.latest}/10 once. Rate it again in a few days and a trend appears here.`
                : 'Rate it below now and then — two ratings is enough to draw a trend.'}
            </Card>
          )}
        </section>

        {/* Check-in. Optional by design: no reminder, no streak, no nagging. */}
        {!resolved && (
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              How is it today?{' '}
              <span className="font-normal normal-case tracking-normal">
                Optional
              </span>
            </h2>
            <Card className="p-3">
              <div className="flex gap-1">
                {Array.from({ length: 11 }, (_, n) => (
                  <button
                    key={n}
                    onClick={() => checkIn(inj.id, n)}
                    disabled={isSaving}
                    aria-label={`Pain ${n} of 10`}
                    className={cn(
                      'h-9 flex-1 rounded-md text-xs tabular-nums',
                      todayRating === n
                        ? 'bg-primary font-medium text-primary-foreground'
                        : 'bg-secondary text-muted-foreground',
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                <span>0 none</span>
                <span>10 severe</span>
              </div>
            </Card>
          </section>
        )}

        {/* Rehab plan */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Rehab plan · this week
            </h2>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setAddingItem((a) => !a)}
              aria-label="Add rehab exercise"
            >
              {addingItem ? (
                <X className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
            </Button>
          </div>

          {addingItem && (
            <RehabPicker
              site={inj.site}
              planKeys={planKeys}
              busy={isSaving}
              onAdd={(item) => addPlanItem(inj.id, item)}
              onAddMany={(items) => addPlanItems(inj.id, items)}
              onCancel={() => setAddingItem(false)}
            />
          )}

          {inj.plan.length === 0 ? (
            !addingItem && (
              <Card className="p-4 text-sm text-muted-foreground">
                No exercises yet. Add the movements you're working on and set how
                many sessions a week you're aiming for.
              </Card>
            )
          ) : (
            <Card className="mt-2 divide-y divide-border">
              {week!.rows.map((row) => (
                <div key={row.item.id} className="p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-sm',
                        row.complete && 'text-muted-foreground',
                      )}
                    >
                      {row.item.name}
                      {row.item.holdSec ? (
                        <span className="ml-1 text-xs text-muted-foreground">
                          {row.item.holdSec}s hold
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 text-xs tabular-nums',
                        row.complete
                          ? 'text-primary'
                          : 'text-muted-foreground',
                      )}
                    >
                      {row.done} / {row.target || '—'}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        row.complete ? 'bg-primary' : 'bg-primary/70',
                      )}
                      style={{ width: `${Math.round(row.progress * 100)}%` }}
                    />
                  </div>
                  {!resolved && (
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        size="sm"
                        variant={row.done > 0 ? 'secondary' : 'default'}
                        disabled={isSaving}
                        onClick={() =>
                          logItem(inj.id, row.item.id, row.item.holdSec ?? null)
                        }
                      >
                        <Check className="h-4 w-4" /> Done today
                      </Button>
                      {row.done > 0 && (
                        <button
                          onClick={() => unlogItem(inj.id, row.item.id)}
                          disabled={isSaving}
                          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                        >
                          Undo
                        </button>
                      )}
                      <button
                        onClick={() => removePlanItem(inj.id, row.item.id)}
                        disabled={isSaving}
                        aria-label={`Remove ${row.item.name}`}
                        className="ml-auto text-muted-foreground"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </Card>
          )}
        </section>

        {/* Lifts that aggravate it — drives the pre-lift warning. */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Aggravates
            </h2>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setPickingLift((p) => !p)}
              aria-label="Add a lift"
            >
              {pickingLift ? (
                <X className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
            </Button>
          </div>
          {inj.aggravates.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {inj.aggravates.map((key) => {
                const name =
                  liftOptions.find((o) => o.key === key)?.name ?? key
                return (
                  <button
                    key={key}
                    onClick={() => toggleAggravates(inj.id, key)}
                    className="flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-1 text-xs text-destructive"
                  >
                    {name}
                    <X className="h-3 w-3" />
                  </button>
                )
              })}
            </div>
          )}
          {pickingLift && (
            <LiftPicker
              options={liftOptions}
              selected={inj.aggravates}
              onPick={(key) => toggleAggravates(inj.id, key)}
            />
          )}
          {inj.aggravates.length === 0 && !pickingLift && (
            <Card className="p-4 text-sm text-muted-foreground">
              Flag the lifts that set it off and you'll get a heads-up on the
              workout screen before you load them.
            </Card>
          )}
        </section>

        {/* Pain flagged mid-set on this joint. */}
        {myFlags.length > 0 && (
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Flagged in workouts · 90 days
            </h2>
            <Card className="divide-y divide-border">
              {myFlags.slice(0, 8).map((f, i) => (
                <div
                  key={`${f.date}-${f.exerciseKey}-${i}`}
                  className="flex items-center justify-between gap-2 p-2.5"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {f.exerciseName}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {dateLabel(f.date)}
                  </span>
                </div>
              ))}
            </Card>
          </section>
        )}

        <section className="space-y-2 pt-2">
          {resolved ? (
            <Button
              variant="outline"
              className="w-full"
              disabled={isSaving}
              onClick={() => reopenInjury(inj.id)}
            >
              <RotateCcw className="h-4 w-4" /> Reopen
            </Button>
          ) : (
            <Button
              className="w-full"
              disabled={isSaving}
              onClick={() => resolveInjury(inj.id)}
            >
              <Check className="h-4 w-4" /> Mark resolved
            </Button>
          )}
          {confirmDelete ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={isSaving}
                onClick={async () => {
                  await removeInjury(inj.id)
                  nav('/rehab')
                }}
              >
                Delete for good
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              className="w-full text-muted-foreground"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
        </section>

        <p className="pb-2 text-[11px] leading-relaxed text-muted-foreground">
          Not medical advice. Sharp pain, swelling, a joint giving way, numbness,
          night pain, or anything lasting more than two weeks — see a
          professional rather than working around it.
        </p>
      </div>
    </div>
  )
}

function LiftPicker({
  options,
  selected,
  onPick,
}: {
  options: { key: string; name: string }[]
  selected: string[]
  onPick: (key: string) => void
}) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = needle
      ? options.filter((o) => o.name.toLowerCase().includes(needle))
      : options
    return list.slice(0, 12)
  }, [options, q])

  return (
    <Card className="space-y-2 p-3">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search lifts"
        aria-label="Search lifts"
      />
      <div className="flex flex-wrap gap-1">
        {shown.map((o) => (
          <button
            key={o.key}
            onClick={() => onPick(o.key)}
            className={cn(
              'rounded-full px-2.5 py-1 text-xs',
              selected.includes(o.key)
                ? 'bg-destructive/15 font-medium text-destructive'
                : 'bg-secondary text-muted-foreground',
            )}
          >
            {o.name}
          </button>
        ))}
        {shown.length === 0 && (
          <p className="text-xs text-muted-foreground">No lifts match.</p>
        )}
      </div>
    </Card>
  )
}
