import { useRef, useState, type ChangeEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { LineChartSvg } from '@/components/LineChartSvg'
import { ActionSheet } from '@/components/ActionSheet'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useLongPress } from '@/lib/useLongPress'
import { useExerciseHistory, useExerciseSessions } from '@/features/strength/useStrength'
import { useCustomExercises } from '@/features/strength/useCustomExercises'
import {
  useFormVideo,
  useUploadFormVideo,
  useDeleteFormVideo,
} from '@/features/strength/useFormVideos'
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
  const [draft, setDraft] = useState('')
  // Long-press a note → action menu (which note), then optionally inline edit.
  const [menuIdx, setMenuIdx] = useState<number | null>(null)
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState('')

  // "Your notes" is stored as newline-joined bullets in the notes column.
  const noteLines = (note?.notes ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  const hidden = note?.hidden_cues ?? []

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
    const next = noteLines.filter((_, i) => i !== idx)
    upsert.mutate({
      exercise_key: exerciseKey,
      notes: next.length ? next.join('\n') : null,
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
    const next = noteLines.map((l, i) => (i === editIdx ? trimmed : l))
    upsert.mutate({ exercise_key: exerciseKey, notes: next.join('\n') })
    cancelEdit()
  }

  // Curated cues ship in code, so "removing" one hides it for this exercise.
  const hideCue = (text: string) => {
    if (!exerciseKey || hidden.includes(text)) return
    if (!window.confirm('Hide this cue for this exercise?')) return
    upsert.mutate({ exercise_key: exerciseKey, hidden_cues: [...hidden, text] })
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
              onHide={hideCue}
            />
          )}
          <FormSection
            title="Execution cues"
            items={form.cues}
            ordered
            hidden={hidden}
            onHide={hideCue}
          />
          {form.mistakes && (
            <FormSection
              title="Common mistakes"
              items={form.mistakes}
              cross
              hidden={hidden}
              onHide={hideCue}
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
  onLongPress,
}: {
  marker: string | number
  markerClass?: string
  text: string
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
    </li>
  )
}

function FormSection({
  title,
  items,
  ordered,
  cross,
  hidden,
  onHide,
}: {
  title: string
  items: string[]
  ordered?: boolean
  cross?: boolean
  hidden: string[]
  onHide: (text: string) => void
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
              onLongPress={() => onHide(it)}
            />
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
