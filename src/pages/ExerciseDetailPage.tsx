import { useRef, useState, type ChangeEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ChevronLeft,
  EyeOff,
  Star,
  Target,
  Pencil,
  Trash2,
  RotateCw,
  TrendingUp,
  Trophy,
  AlertTriangle,
} from 'lucide-react'
import { LineChartSvg } from '@/components/LineChartSvg'
import { ActionSheet } from '@/components/ActionSheet'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useLongPress } from '@/lib/useLongPress'
import {
  useExerciseHistory,
  useExerciseSessions,
  type ExerciseSession,
} from '@/features/strength/useStrength'
import { useCustomExercises } from '@/features/strength/useCustomExercises'
import {
  useFormVideo,
  useUploadFormVideo,
  useDeleteFormVideo,
} from '@/features/strength/useFormVideos'
import { estimated1RM } from '@/lib/calc'
import {
  currentE1RM,
  suggestNext,
  weightForReps,
  formatGoalTarget,
  requiredPace,
  formatPace,
  projectGoalEta,
  PROGRESSION_LABEL,
  PROGRESSION_SOURCE,
} from '@/lib/progression'
import type { GoalProjection } from '@/lib/progression'
import {
  useStrengthGoal,
  useSaveStrengthGoal,
  useUpdateStrengthGoal,
  useDeleteStrengthGoal,
} from '@/features/strength/useStrengthGoals'
import { Input } from '@/components/ui/input'
import type { ProgressionMethod, StrengthGoal } from '@/lib/database.types'
import { dateLabel, daysBetweenISO, todayISO } from '@/lib/date'
import {
  useExerciseNotes,
  useUpsertExerciseNote,
} from '@/features/strength/useExerciseNotes'
import { EXERCISES } from '@/data/exercises'
import { getExerciseForm } from '@/data/exerciseForm'
import { builtinKeyForName } from '@/data/exerciseAliases'

const METRICS = [
  { key: 'e1rm', label: 'Est. 1RM' },
  { key: 'max', label: 'Max weight' },
  { key: 'total', label: 'Total volume' },
  { key: 'avg', label: 'Average weight' },
] as const
type MetricKey = (typeof METRICS)[number]['key']

const ACCENT = 'var(--primary)'
const GOAL = '#d97706' // amber-600 — the goal line, distinct from the accent trend
const TABS = ['history', 'form', 'videos', 'progress'] as const
type Tab = (typeof TABS)[number]

// Stored clips are capped at ~30s; the grace keeps a clip that lands at 31s
// from being bounced. Clips whose duration can't be read fall through to the
// bucket's 200 MB size cap instead.
const MAX_CLIP_SEC = 33

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
    <div className="mx-auto min-h-svh w-full max-w-md bg-background pb-[env(safe-area-inset-bottom)]">
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
        <GoalCard exerciseKey={key} name={name} />
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
        ) : tab === 'videos' ? (
          <VideosTab exerciseKey={key} />
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

// All-time bests for this lift, derived from the same session history the
// History tab already loads (no extra query). The persistent counterpart to the
// live PR banners shown during a workout: heaviest set, biggest single-set
// volume, and biggest session tonnage. Returns null for unweighted lifts
// (nothing to rank), so the card simply doesn't appear.
function RecordsCard({ sessions }: { sessions: ExerciseSession[] }) {
  let maxWeight = 0
  let maxWeightReps: number | null = null
  let bestSetVol = 0
  let bestSetVolLabel = ''
  let bestSessionVol = 0
  let bestSessionDate = ''
  for (const s of sessions) {
    let sessionVol = 0
    for (const x of s.sets) {
      const w = x.weight_lb ?? 0
      const r = x.reps ?? 0
      if (w > maxWeight) {
        maxWeight = w
        maxWeightReps = x.reps
      }
      const v = r * w
      if (v > bestSetVol) {
        bestSetVol = v
        bestSetVolLabel = `${w} × ${r}`
      }
      sessionVol += v
    }
    if (sessionVol > bestSessionVol) {
      bestSessionVol = sessionVol
      bestSessionDate = s.date
    }
  }

  const records = [
    maxWeight > 0 && {
      label: 'Heaviest set',
      value: setLabel(maxWeight, maxWeightReps),
    },
    bestSetVol > 0 && {
      label: 'Best set volume',
      value: `${Math.round(bestSetVol)} lb`,
      detail: bestSetVolLabel,
    },
    bestSessionVol > 0 && {
      label: 'Best session volume',
      value: `${Math.round(bestSessionVol)} lb`,
      detail: dateLabel(bestSessionDate),
    },
  ].filter(Boolean) as { label: string; value: string; detail?: string }[]

  if (!records.length) return null

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-border p-3">
        <Trophy className="h-4 w-4 text-amber-500" />
        <span className="text-sm font-semibold">Records</span>
      </div>
      <div className="space-y-2 p-3">
        {records.map((r) => (
          <div
            key={r.label}
            className="flex items-baseline justify-between gap-2"
          >
            <span className="text-sm text-muted-foreground">{r.label}</span>
            <span className="text-sm font-semibold tabular-nums">
              {r.value}
              {r.detail && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  {r.detail}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
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
      <RecordsCard sessions={rows} />
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
            {s.notes && (
              <div className="whitespace-pre-line border-t border-border px-3 py-2 text-xs text-muted-foreground">
                {s.notes}
              </div>
            )}
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
  const [draft, setDraft] = useState('')
  // Long-press a note → action menu (which note), then optionally inline edit.
  const [menuIdx, setMenuIdx] = useState<number | null>(null)
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState('')
  // Long-press a curated cue → star / hide menu (keyed by the cue string).
  const [cueMenu, setCueMenu] = useState<string | null>(null)

  // "Your notes" is stored as newline-joined bullets in the notes column.
  const noteLines = (note?.notes ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  const hidden = note?.hidden_cues ?? []
  const starred = note?.starred_cues ?? []

  const addNote = () => {
    const trimmed = draft.trim()
    if (!exerciseKey || !trimmed) return
    upsert.mutate({
      exercise_key: exerciseKey,
      notes: [...noteLines, trimmed].join('\n'),
    })
    setDraft('')
  }

  const removeNote = (idx: number) => {
    if (!exerciseKey) return
    const text = noteLines[idx]
    const next = noteLines.filter((_, i) => i !== idx)
    upsert.mutate({
      exercise_key: exerciseKey,
      notes: next.length ? next.join('\n') : null,
      // Drop the note's star so it can't linger or pre-star a re-added note.
      ...(starred.includes(text)
        ? { starred_cues: starred.filter((c) => c !== text) }
        : {}),
    })
  }

  const startEdit = (idx: number) => {
    setEditDraft(noteLines[idx])
    setEditIdx(idx)
  }

  const cancelEdit = () => {
    setEditIdx(null)
    setEditDraft('')
  }

  const saveEdit = () => {
    const trimmed = editDraft.trim()
    if (!exerciseKey || editIdx === null || !trimmed) return
    const old = noteLines[editIdx]
    const next = noteLines.map((l, i) => (i === editIdx ? trimmed : l))
    upsert.mutate({
      exercise_key: exerciseKey,
      notes: next.join('\n'),
      // Move the star onto the edited text so it doesn't fall off.
      ...(starred.includes(old)
        ? { starred_cues: starred.map((c) => (c === old ? trimmed : c)) }
        : {}),
    })
    cancelEdit()
  }

  // Curated cues ship in code, so "removing" one hides it for this exercise.
  const hideCue = (text: string) => {
    if (!exerciseKey || hidden.includes(text)) return
    upsert.mutate({ exercise_key: exerciseKey, hidden_cues: [...hidden, text] })
  }

  // Star / unstar a curated cue or one of your own notes (same store).
  const toggleStar = (text: string) => {
    if (!exerciseKey) return
    const next = starred.includes(text)
      ? starred.filter((c) => c !== text)
      : [...starred, text]
    upsert.mutate({ exercise_key: exerciseKey, starred_cues: next })
  }

  const restoreCues = () => {
    if (!exerciseKey) return
    upsert.mutate({ exercise_key: exerciseKey, hidden_cues: [] })
  }

  return (
    <div className="space-y-4">
      {form ? (
        <>
          {form.setup && (
            <FormSection
              title="Setup"
              items={form.setup}
              hidden={hidden}
              starred={starred}
              onLongPress={setCueMenu}
            />
          )}
          <FormSection
            title="Execution cues"
            items={form.cues}
            ordered
            hidden={hidden}
            starred={starred}
            onLongPress={setCueMenu}
          />
          {form.mistakes && (
            <FormSection
              title="Common mistakes"
              items={form.mistakes}
              cross
              hidden={hidden}
              starred={starred}
              onLongPress={setCueMenu}
            />
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

      {hidden.length > 0 && (
        <button
          onClick={restoreCues}
          className="px-1 text-xs font-medium text-primary"
        >
          Restore hidden cues ({hidden.length})
        </button>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Your notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {noteLines.length > 0 && (
            <ul className="space-y-2">
              {noteLines.map((line, i) =>
                editIdx === i ? (
                  <li key={i} className="flex items-center gap-2">
                    <input
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          saveEdit()
                        } else if (e.key === 'Escape') {
                          cancelEdit()
                        }
                      }}
                      autoFocus
                      className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <Button onClick={saveEdit} disabled={!editDraft.trim()}>
                      Save
                    </Button>
                    <button
                      onClick={cancelEdit}
                      className="px-1 text-xs font-medium text-muted-foreground"
                    >
                      Cancel
                    </button>
                  </li>
                ) : (
                  <BulletRow
                    key={i}
                    marker="•"
                    markerClass="text-primary"
                    text={line}
                    starred={starred.includes(line)}
                    onLongPress={() => setMenuIdx(i)}
                  />
                ),
              )}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addNote()
                }
              }}
              placeholder="Add a cue, reminder, or setup detail…"
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button onClick={addNote} disabled={!draft.trim()}>
              Add
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {upsert.isPending
              ? 'Saving…'
              : 'Press and hold a note to edit or delete it.'}
          </p>
        </CardContent>
      </Card>

      {menuIdx !== null && noteLines[menuIdx] !== undefined && (
        <ActionSheet
          title={noteLines[menuIdx]}
          starred={starred.includes(noteLines[menuIdx])}
          starLabel={
            starred.includes(noteLines[menuIdx]) ? 'Unstar note' : 'Star note'
          }
          onStar={() => {
            toggleStar(noteLines[menuIdx])
            setMenuIdx(null)
          }}
          editLabel="Edit note"
          deleteLabel="Delete note"
          onEdit={() => {
            startEdit(menuIdx)
            setMenuIdx(null)
          }}
          onDelete={() => {
            removeNote(menuIdx)
            setMenuIdx(null)
          }}
          onClose={() => setMenuIdx(null)}
        />
      )}

      {cueMenu !== null && (
        <CueActionSheet
          text={cueMenu}
          starred={starred.includes(cueMenu)}
          onToggleStar={() => {
            toggleStar(cueMenu)
            setCueMenu(null)
          }}
          onHide={() => {
            hideCue(cueMenu)
            setCueMenu(null)
          }}
          onClose={() => setCueMenu(null)}
        />
      )}

      <p className="px-1 text-xs text-muted-foreground">
        Form cues are general guidance, not a substitute for a qualified coach.
        Adjust for your body and stop if something hurts.
      </p>
    </div>
  )
}

// One bullet row: tap does nothing, press-and-hold (450ms) fires onLongPress
// (your notes → an Edit/Delete menu; curated cues → hide).
function BulletRow({
  marker,
  markerClass,
  text,
  starred,
  onLongPress,
}: {
  marker: string | number
  markerClass?: string
  text: string
  starred?: boolean
  onLongPress: () => void
}) {
  const press = useLongPress(onLongPress, () => {})
  return (
    <li
      {...press}
      className="flex cursor-pointer select-none gap-2.5 text-sm active:opacity-60"
    >
      <span
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
          markerClass,
        )}
      >
        {marker}
      </span>
      <span className="leading-snug">{text}</span>
      {starred && (
        <Star className="ml-auto mt-0.5 h-4 w-4 shrink-0 fill-amber-400 text-amber-400" />
      )}
    </li>
  )
}

// Long-press menu for a curated cue: star it as especially helpful, or hide it.
function CueActionSheet({
  text,
  starred,
  onToggleStar,
  onHide,
  onClose,
}: {
  text: string
  starred: boolean
  onToggleStar: () => void
  onHide: () => void
  onClose: () => void
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="mx-auto w-full max-w-md p-3"
        onClick={(ev) => ev.stopPropagation()}
      >
        <Card className="overflow-hidden">
          <div className="truncate border-b border-border p-3 text-center text-xs text-muted-foreground">
            {text}
          </div>
          <button
            onClick={onToggleStar}
            className="flex w-full items-center gap-3 p-4 text-left active:bg-accent"
          >
            <Star
              className={cn(
                'h-4 w-4',
                starred
                  ? 'fill-amber-400 text-amber-400'
                  : 'text-muted-foreground',
              )}
            />
            <span className="text-sm font-medium">
              {starred ? 'Unstar cue' : 'Star cue'}
            </span>
          </button>
          <button
            onClick={onHide}
            className="flex w-full items-center gap-3 border-t border-border p-4 text-left text-destructive active:bg-accent"
          >
            <EyeOff className="h-4 w-4" />
            <span className="text-sm font-medium">Hide cue</span>
          </button>
        </Card>
        <button
          onClick={onClose}
          className="mt-2 w-full rounded-xl bg-card p-4 text-sm font-medium active:bg-accent"
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  )
}

function FormSection({
  title,
  items,
  ordered,
  cross,
  hidden,
  starred,
  onLongPress,
}: {
  title: string
  items: string[]
  ordered?: boolean
  cross?: boolean
  hidden: string[]
  starred: string[]
  onLongPress: (text: string) => void
}) {
  const visible = items.filter((it) => !hidden.includes(it))
  if (!visible.length) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {visible.map((it, i) => (
            <BulletRow
              key={it}
              marker={ordered ? i + 1 : cross ? '✕' : '•'}
              markerClass={
                ordered
                  ? 'bg-primary/15 text-primary'
                  : cross
                    ? 'text-destructive'
                    : 'text-primary'
              }
              text={it}
              starred={starred.includes(it)}
              onLongPress={() => onLongPress(it)}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function ProgressTab({ exerciseKey }: { exerciseKey: string | undefined }) {
  const { data: history } = useExerciseHistory(exerciseKey)
  const { data: goal } = useStrengthGoal(exerciseKey)
  // null = no explicit pick yet → default to Est. 1RM when a goal exists (so the
  // goal line shows), else Max weight. A user pick sticks regardless.
  const [picked, setPicked] = useState<MetricKey | null>(null)
  const metric: MetricKey = picked ?? (goal ? 'e1rm' : 'max')

  const rows = history ?? []
  const chartData = rows.map((r) => ({ date: r.date.slice(5), value: r[metric] }))
  const bestMax = rows.reduce((m, r) => Math.max(m, r.max), 0)
  const bestVol = rows.reduce((m, r) => Math.max(m, r.total), 0)
  const meta = METRICS.find((m) => m.key === metric) ?? METRICS[0]

  // The goal is a target 1RM, so the goal line + ETA only apply to that series.
  const showGoal = metric === 'e1rm' && !!goal
  const proj = showGoal
    ? projectGoalEta(
        rows.map((r) => ({ date: r.date, e1rm: r.e1rm })),
        goal.target_1rm_lb,
      )
    : null

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

      <Select
        value={metric}
        onChange={(e) => setPicked(e.target.value as MetricKey)}
      >
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
            <>
              <LineChartSvg
                data={chartData}
                xKey="date"
                refLine={
                  showGoal
                    ? {
                        value: goal.target_1rm_lb,
                        color: GOAL,
                        label: `Goal ${goal.target_1rm_lb}`,
                      }
                    : undefined
                }
                series={[
                  {
                    key: 'value',
                    color: ACCENT,
                    strokeWidth: 2.5,
                    dotRadius: 3,
                    name: meta.label,
                  },
                ]}
              />
              {showGoal && proj && (
                <GoalEtaCaption proj={proj} goal={goal} />
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// The actual-trend projection under the e1RM chart: where your logged trend is
// headed (vs. the goal card's REQUIRED pace). Reached / flat / on-track states.
function GoalEtaCaption({
  proj,
  goal,
}: {
  proj: GoalProjection
  goal: StrengthGoal
}) {
  if (proj.reached)
    return <p className="mt-3 text-xs font-medium text-primary">🎉 Goal reached</p>
  if (!proj.etaISO)
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        Not trending up yet — no estimate.
      </p>
    )
  const eta = new Date(proj.etaISO + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
  })
  const behind = goal.target_date ? proj.etaISO > goal.target_date : false
  return (
    <div className="mt-3 flex items-center gap-2">
      <TrendingUp className="h-4 w-4 shrink-0 text-primary" />
      <span className="text-xs text-muted-foreground">
        Trend +{formatPace(proj.slopePerWeek)} lb/wk · reach {goal.target_1rm_lb}{' '}
        by ≈ {eta}
      </span>
      {goal.target_date && (
        <span
          className={cn(
            'ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
            behind
              ? 'bg-destructive/10 text-destructive'
              : 'bg-primary/10 text-primary',
          )}
        >
          {behind ? 'behind' : 'on track'}
        </span>
      )}
    </div>
  )
}

function VideosTab({ exerciseKey }: { exerciseKey: string | undefined }) {
  const { data, isLoading } = useFormVideo(exerciseKey)
  const upload = useUploadFormVideo()
  const del = useDeleteFormVideo()
  const inputRef = useRef<HTMLInputElement>(null)
  const err = (upload.error ?? del.error) as Error | null

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // let the same file be re-picked later
    if (!file || !exerciseKey) return
    const duration_sec = await readDuration(file)
    if (duration_sec != null && duration_sec > MAX_CLIP_SEC) {
      window.alert(
        `Clip is ${fmtDuration(duration_sec)} — please keep it under 30s.`,
      )
      return
    }
    if (
      data &&
      !window.confirm('Replace your current clip? The old one is deleted.')
    )
      return
    upload.mutate({ exercise_key: exerciseKey, file, duration_sec })
  }

  const onDelete = () => {
    if (!exerciseKey || !data || !window.confirm('Delete this form clip?')) return
    del.mutate({ exercise_key: exerciseKey, storage_path: data.row.storage_path })
  }

  return (
    <div className="space-y-4">
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={onPick}
      />

      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      ) : data ? (
        <Card className="overflow-hidden">
          <video
            key={data.url}
            src={data.url}
            controls
            playsInline
            preload="metadata"
            className="aspect-video w-full bg-black"
          />
          <CardContent className="flex items-center justify-between gap-2 py-3">
            <span className="text-xs text-muted-foreground">
              {[
                dateLabel(data.row.created_at.slice(0, 10)),
                data.row.duration_sec ? fmtDuration(data.row.duration_sec) : null,
                data.row.size_bytes ? fmtSize(data.row.size_bytes) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              disabled={del.isPending}
            >
              Delete
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No form clip yet. Record one to review your technique over time.
          </CardContent>
        </Card>
      )}

      <Button
        className="w-full"
        onClick={() => inputRef.current?.click()}
        disabled={upload.isPending}
      >
        {upload.isPending
          ? 'Uploading…'
          : data
            ? 'Replace clip'
            : 'Record / add clip'}
      </Button>

      {err && <p className="px-1 text-xs text-destructive">{err.message}</p>}

      <p className="px-1 text-xs text-muted-foreground">
        One clip is kept per exercise — a new recording replaces it. Clips must
        be under 30s; film ~20–30s at 720p to keep files small.
      </p>
    </div>
  )
}

// Best-effort duration read from the file's metadata (null if it won't load).
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const vid = document.createElement('video')
    vid.preload = 'metadata'
    vid.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(Number.isFinite(vid.duration) ? Math.round(vid.duration) : null)
    }
    vid.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    vid.src = url
  })
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtSize(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
}

const METHODS: ProgressionMethod[] = ['linear', 'double', '531']

// Pinned at the top of the exercise page: set a target 1RM, switch progression
// method, see progress to the goal, and the suggested next session (with its
// reasoning + source). Current strength is read live from logged sessions.
function GoalCard({
  exerciseKey,
  name,
}: {
  exerciseKey: string | undefined
  name: string
}) {
  const { data: goal } = useStrengthGoal(exerciseKey)
  const { data: sessions } = useExerciseSessions(exerciseKey)
  const update = useUpdateStrengthGoal()
  const del = useDeleteStrengthGoal()
  const [editing, setEditing] = useState(false)

  const priorSessions = (sessions ?? []).map((s) =>
    s.sets.map((x) => ({
      weight_lb: x.weight_lb,
      reps: x.reps,
      effort: x.effort,
      feel: x.feel,
      pain: x.pain,
    })),
  )
  const current = currentE1RM(priorSessions)

  if (!exerciseKey) return null

  if (editing)
    return (
      <GoalForm
        exerciseKey={exerciseKey}
        name={name}
        goal={goal ?? null}
        onClose={() => setEditing(false)}
      />
    )

  if (!goal)
    return (
      <Card>
        <button
          onClick={() => setEditing(true)}
          className="flex w-full items-center justify-center gap-2 p-4 text-sm font-medium text-primary active:bg-accent"
        >
          <Target className="h-4 w-4" /> Set a strength goal
        </button>
      </Card>
    )

  const sug = suggestNext(goal, priorSessions)
  const pct = Math.min(
    100,
    Math.max(0, Math.round((current / goal.target_1rm_lb) * 100)) || 0,
  )
  const reached = current > 0 && current >= goal.target_1rm_lb
  const pace = goal.target_date
    ? requiredPace(
        current,
        goal.target_1rm_lb,
        daysBetweenISO(todayISO(), goal.target_date),
      )
    : null
  const hintReps = goal.method === 'double' ? goal.rep_high : goal.rep_low
  const hintWeight =
    Math.round(weightForReps(goal.target_1rm_lb, hintReps) / 5) * 5
  const inc = goal.increment_lb ?? 5

  const changeMethod = (m: ProgressionMethod) => {
    const patch: { id: string; exercise_key: string } & Partial<StrengthGoal> = {
      id: goal.id,
      exercise_key: goal.exercise_key,
      method: m,
    }
    // Seed the 5/3/1 training max from current strength the first time.
    if (m === '531' && goal.tm_lb == null) {
      patch.tm_lb = Math.round(current * 0.9) || null
      patch.week = 1
      patch.cycle = 1
    }
    update.mutate(patch)
  }

  const advance531 = () => {
    const nextWeek = goal.week >= 4 ? 1 : goal.week + 1
    const patch: { id: string; exercise_key: string } & Partial<StrengthGoal> = {
      id: goal.id,
      exercise_key: goal.exercise_key,
      week: nextWeek,
    }
    // Wrapping past the deload week starts a new cycle and bumps the TM.
    if (nextWeek === 1) {
      patch.cycle = goal.cycle + 1
      patch.tm_lb = (goal.tm_lb ?? Math.round(current * 0.9)) + inc
    }
    update.mutate(patch)
  }

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-semibold">
            <Target className="h-4 w-4 text-primary" /> Strength goal
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setEditing(true)}
              aria-label="Edit goal"
              className="text-muted-foreground active:text-foreground"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                if (window.confirm('Delete this strength goal?'))
                  del.mutate({ id: goal.id, exercise_key: goal.exercise_key })
              }}
              aria-label="Delete goal"
              className="text-muted-foreground active:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {current ? `Now ~${current} lb` : 'No history yet'}
          </span>
          <span className="font-medium">Goal {formatGoalTarget(goal)}</span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-1.5 text-xs text-muted-foreground">
          {reached
            ? '🎉 Goal reached!'
            : `${pct}% · ≈ ${hintWeight} × ${hintReps} to reach ${goal.target_1rm_lb}`}
        </div>
        {pace && !reached && (
          <div className="mt-1 text-xs text-muted-foreground">
            {pace.overdue
              ? `Past target · ${dateLabel(goal.target_date!)}`
              : `By ${dateLabel(goal.target_date!)} · need +${formatPace(pace.neededPerWeek)} lb/wk`}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Method</span>
          <Select
            className="h-8 flex-1"
            value={goal.method}
            onChange={(e) => changeMethod(e.target.value as ProgressionMethod)}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {PROGRESSION_LABEL[m]}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      <Card className="border-primary/40 p-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold">Next session</span>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {goal.method === '531' ? `Week ${goal.week} of 4` : 'suggested'}
          </span>
        </div>

        {sug.action === 'start' ? (
          <p className="mt-2 text-sm text-muted-foreground">{sug.rationale}</p>
        ) : (
          <>
            {goal.method === '531' ? (
              <div className="mt-2 space-y-1">
                {sug.sets.map((s, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-muted-foreground">Set {i + 1}</span>
                    <span className="font-medium tabular-nums">
                      {s.weightLb} lb × {s.reps}
                      {s.amrap ? '+' : ''}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-xl font-bold tabular-nums">
                {sug.headline}
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">{sug.rationale}</p>
          </>
        )}

        {sug.warning && (
          <div className="mt-2 flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>{sug.warning}</span>
          </div>
        )}

        <p className="mt-2 text-[11px] text-muted-foreground">{sug.source}</p>

        {goal.method === '531' && current > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3 w-full"
            onClick={advance531}
          >
            <RotateCw className="h-3.5 w-3.5" />
            {goal.week >= 4
              ? `Start next cycle · +${inc} lb`
              : `Advance to week ${goal.week + 1}`}
          </Button>
        )}
      </Card>
    </div>
  )
}

function GoalForm({
  exerciseKey,
  name,
  goal,
  onClose,
}: {
  exerciseKey: string
  name: string
  goal: StrengthGoal | null
  onClose: () => void
}) {
  const save = useSaveStrengthGoal()
  const update = useUpdateStrengthGoal()
  const [weight, setWeight] = useState(
    goal ? String(goal.target_weight_lb) : '',
  )
  const [reps, setReps] = useState(String(goal?.target_reps ?? 1))
  const [method, setMethod] = useState<ProgressionMethod>(
    goal?.method ?? 'double',
  )
  const [sets, setSets] = useState(String(goal?.sets ?? 3))
  const [lo, setLo] = useState(String(goal?.rep_low ?? 5))
  const [hi, setHi] = useState(String(goal?.rep_high ?? 8))
  const [inc, setInc] = useState(String(goal?.increment_lb ?? 5))
  const [targetDate, setTargetDate] = useState(goal?.target_date ?? '')
  const pending = save.isPending || update.isPending

  const w = parseFloat(weight)
  const r = Math.max(1, parseInt(reps, 10) || 1)
  const derived1RM = w > 0 ? Math.round(estimated1RM(w, r)) : 0

  const onSave = () => {
    if (!(w > 0)) return
    const repLow = parseInt(lo, 10) || 5
    const base = {
      exercise_key: exerciseKey,
      exercise_name: name,
      target_weight_lb: w,
      target_reps: r,
      target_1rm_lb: derived1RM,
      method,
      increment_lb: parseFloat(inc) || 5,
      rep_low: repLow,
      rep_high: Math.max(parseInt(hi, 10) || repLow, repLow),
      sets: parseInt(sets, 10) || 3,
      target_date: targetDate || null,
    }
    if (goal) update.mutate({ id: goal.id, ...base }, { onSuccess: onClose })
    else save.mutate(base, { onSuccess: onClose })
  }

  return (
    <Card className="space-y-3 p-3">
      <div className="text-sm font-semibold">
        {goal ? 'Edit goal' : 'New strength goal'}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-muted-foreground">
          Target weight (lb)
          <Input
            type="number"
            inputMode="decimal"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="e.g. 225"
            className="mt-1"
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          Target reps
          <Input
            type="number"
            inputMode="numeric"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            placeholder="1"
            className="mt-1"
          />
        </label>
      </div>
      {derived1RM > 0 && (
        <p className="text-[11px] text-muted-foreground">
          = {derived1RM} lb est. 1RM (Epley) — what progress tracks against
        </p>
      )}

      <label className="block text-xs text-muted-foreground">
        Target date (optional)
        <Input
          type="date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          className="mt-1"
        />
      </label>

      <label className="block text-xs text-muted-foreground">
        Method
        <Select
          value={method}
          onChange={(e) => setMethod(e.target.value as ProgressionMethod)}
          className="mt-1"
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {PROGRESSION_LABEL[m]}
            </option>
          ))}
        </Select>
      </label>
      <p className="text-[11px] text-muted-foreground">
        {PROGRESSION_SOURCE[method]}
      </p>

      {method !== '531' && (
        <div className="grid grid-cols-3 gap-2">
          <label className="block text-xs text-muted-foreground">
            Sets
            <Input
              type="number"
              inputMode="numeric"
              value={sets}
              onChange={(e) => setSets(e.target.value)}
              className="mt-1"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            {method === 'double' ? 'Rep low' : 'Reps'}
            <Input
              type="number"
              inputMode="numeric"
              value={lo}
              onChange={(e) => setLo(e.target.value)}
              className="mt-1"
            />
          </label>
          {method === 'double' && (
            <label className="block text-xs text-muted-foreground">
              Rep high
              <Input
                type="number"
                inputMode="numeric"
                value={hi}
                onChange={(e) => setHi(e.target.value)}
                className="mt-1"
              />
            </label>
          )}
        </div>
      )}

      <label className="block text-xs text-muted-foreground">
        Weight step (lb)
        <Select
          value={inc}
          onChange={(e) => setInc(e.target.value)}
          className="mt-1"
        >
          <option value="2.5">2.5 (microload)</option>
          <option value="5">5 (upper body)</option>
          <option value="10">10 (lower body)</option>
        </Select>
      </label>

      <div className="flex gap-2 pt-1">
        <Button
          className="flex-1"
          onClick={onSave}
          disabled={!(w > 0) || pending}
        >
          {pending ? 'Saving…' : 'Save goal'}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Card>
  )
}
