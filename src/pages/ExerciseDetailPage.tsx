import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { LineChartSvg } from '@/components/LineChartSvg'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useExerciseHistory, useExerciseSessions } from '@/features/strength/useStrength'
import { useCustomExercises } from '@/features/strength/useCustomExercises'
import { estimated1RM } from '@/lib/calc'
import { dateLabel } from '@/lib/date'
import {
  useExerciseNotes,
  useUpsertExerciseNote,
} from '@/features/strength/useExerciseNotes'
import { EXERCISES } from '@/data/exercises'
import { getExerciseForm } from '@/data/exerciseForm'
import { builtinKeyForName } from '@/data/exerciseAliases'

const METRICS = [
  { key: 'max', label: 'Max weight' },
  { key: 'total', label: 'Total volume' },
  { key: 'avg', label: 'Average weight' },
] as const
type MetricKey = (typeof METRICS)[number]['key']

const GREEN = '#16a34a'
const TABS = ['history', 'form', 'progress'] as const
type Tab = (typeof TABS)[number]

export function ExerciseDetailPage() {
  const { key } = useParams()
  const nav = useNavigate()
  const [tab, setTab] = useState<Tab>('history')
  const { data: custom } = useCustomExercises()

  const builtin = EXERCISES.find((e) => e.key === key)
  const customEx = (custom ?? []).find((c) => `custom:${c.id}` === key)
  const name = builtin?.name ?? customEx?.name ?? key ?? 'Exercise'
  // Built-in cues are keyed by built-in key; imported/custom lifts land under a
  // custom: key, so fall back to matching the exercise's name to a built-in.
  const formKey = builtin?.key ?? builtinKeyForName(customEx?.name)
  const subtitle = [
    builtin?.muscle ?? customEx?.muscle,
    builtin?.equipment ?? customEx?.equipment,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background">
      <PageHeader
        title={name}
        subtitle={subtitle || undefined}
        left={
          <Button variant="ghost" size="icon" onClick={() => nav(-1)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-4 p-4">
        <div className="flex rounded-lg bg-muted p-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'flex-1 rounded-md py-1.5 text-sm font-medium capitalize transition-colors',
                tab === t
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground',
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'history' ? (
          <HistoryTab exerciseKey={key} />
        ) : tab === 'form' ? (
          <FormTab exerciseKey={key} formKey={formKey} />
        ) : (
          <ProgressTab exerciseKey={key} />
        )}
      </div>
    </div>
  )
}

function setLabel(weight: number | null, reps: number | null): string {
  const wt = weight != null ? `${weight} lb` : null
  const rp = reps != null ? String(reps) : null
  if (wt && rp) return `${wt} × ${rp}`
  if (wt) return wt
  if (rp) return `${rp} reps`
  return '—'
}

function HistoryTab({ exerciseKey }: { exerciseKey: string | undefined }) {
  const { data: sessions, isLoading } = useExerciseSessions(exerciseKey)
  const rows = sessions ?? []

  if (isLoading)
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
    )

  if (!rows.length)
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No logged sets yet. Sets you record for this exercise in a workout
          show up here.
        </CardContent>
      </Card>
    )

  return (
    <div className="space-y-3">
      {rows.map((s) => {
        const best = s.sets.reduce(
          (m, x) => Math.max(m, estimated1RM(x.weight_lb ?? 0, x.reps ?? 0)),
          0,
        )
        return (
          <Card key={s.workoutId} className="overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-border p-3">
              <div>
                <div className="text-sm font-semibold">{dateLabel(s.date)}</div>
                {s.name && (
                  <div className="text-xs text-muted-foreground">{s.name}</div>
                )}
              </div>
              {best > 0 && (
                <span className="text-xs text-muted-foreground">
                  e1RM {Math.round(best)}
                </span>
              )}
            </div>
            <div className="space-y-1 p-3">
              {s.sets.map((x, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="w-5 text-center text-xs text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="font-medium tabular-nums">
                    {setLabel(x.weight_lb, x.reps)}
                  </span>
                  {x.effort != null && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      RPE {x.effort}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

function FormTab({
  exerciseKey,
  formKey,
}: {
  exerciseKey: string | undefined
  formKey: string | undefined
}) {
  const form = getExerciseForm(formKey)
  const { data: note } = useExerciseNotes(exerciseKey)
  const upsert = useUpsertExerciseNote()
  const [notes, setNotes] = useState('')

  // Populate the editor once the saved note loads (and on later changes).
  useEffect(() => {
    setNotes(note?.notes ?? '')
  }, [note?.notes])

  const save = () => {
    if (!exerciseKey) return
    const trimmed = notes.trim()
    if (trimmed === (note?.notes ?? '')) return
    upsert.mutate({ exercise_key: exerciseKey, notes: trimmed || null })
  }

  return (
    <div className="space-y-4">
      {form ? (
        <>
          {form.setup && (
            <FormSection title="Setup" items={form.setup} />
          )}
          <FormSection title="Execution cues" items={form.cues} ordered />
          {form.mistakes && (
            <FormSection title="Common mistakes" items={form.mistakes} cross />
          )}
        </>
      ) : (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            No built-in form guide for this exercise yet — add your own cues
            below.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Your notes</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={save}
            placeholder="Add your own cues, reminders, or setup details…"
            rows={4}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {upsert.isPending && (
            <p className="mt-1 text-xs text-muted-foreground">Saving…</p>
          )}
        </CardContent>
      </Card>

      <p className="px-1 text-xs text-muted-foreground">
        Form cues are general guidance, not a substitute for a qualified coach.
        Adjust for your body and stop if something hurts.
      </p>
    </div>
  )
}

function FormSection({
  title,
  items,
  ordered,
  cross,
}: {
  title: string
  items: string[]
  ordered?: boolean
  cross?: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li key={i} className="flex gap-2.5 text-sm">
              <span
                className={cn(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  ordered
                    ? 'bg-primary/15 text-primary'
                    : cross
                      ? 'text-destructive'
                      : 'text-primary',
                )}
              >
                {ordered ? i + 1 : cross ? '✕' : '•'}
              </span>
              <span className="leading-snug">{it}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function ProgressTab({ exerciseKey }: { exerciseKey: string | undefined }) {
  const { data: history } = useExerciseHistory(exerciseKey)
  const [metric, setMetric] = useState<MetricKey>('max')

  const rows = history ?? []
  const chartData = rows.map((r) => ({ date: r.date.slice(5), value: r[metric] }))
  const bestMax = rows.reduce((m, r) => Math.max(m, r.max), 0)
  const bestVol = rows.reduce((m, r) => Math.max(m, r.total), 0)
  const meta = METRICS.find((m) => m.key === metric) ?? METRICS[0]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-3 text-center">
          <div className="text-lg font-bold">{bestMax || '—'}</div>
          <div className="text-xs text-muted-foreground">Best set (lb)</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-lg font-bold">{bestVol || '—'}</div>
          <div className="text-xs text-muted-foreground">Best volume (lb)</div>
        </Card>
      </div>

      <Select value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)}>
        {METRICS.map((m) => (
          <option key={m.key} value={m.key}>
            {m.label}
          </option>
        ))}
      </Select>

      <Card>
        <CardHeader>
          <CardTitle>{meta.label} over time</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length < 2 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Log this exercise in 2+ sessions to see a trend.
            </p>
          ) : (
            <LineChartSvg
              data={chartData}
              xKey="date"
              series={[
                {
                  key: 'value',
                  color: GREEN,
                  strokeWidth: 2.5,
                  dotRadius: 3,
                  name: meta.label,
                },
              ]}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
