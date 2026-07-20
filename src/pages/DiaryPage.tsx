import { useRef, useState, type TouchEvent as ReactTouchEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Flame,
  Footprints,
  CheckCircle2,
  Circle,
  X,
  BookmarkPlus,
  Copy,
  ArrowRightLeft,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { ActionSheet } from '@/components/ActionSheet'
import { CalorieRing, RING_GREEN } from '@/components/CalorieRing'
import { ZoneBadge } from '@/components/ZoneBadge'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useDiary,
  useStreak,
  useDeleteDiaryEntry,
  useDeleteDiaryEntries,
  useMoveDiaryEntries,
  useCopyEntriesToDay,
} from '@/features/diary/useDiary'
import { useCreateMealFromEntries } from '@/features/meals/useMeals'
import {
  useExerciseEntries,
  useDeleteExercise,
} from '@/features/exercise/useExercise'
import { useProfile } from '@/features/profile/useProfile'
import { useLatestWeight } from '@/features/measurements/useMeasurements'
import { useSteps, useConnectSteps } from '@/features/steps/useSteps'
import { resolveCalorieGoal, resolveMacroTargets } from '@/lib/calc'
import { scaleNutrients, sumNutrients } from '@/lib/nutrients'
import { todayISO, addDaysISO, dateLabel } from '@/lib/date'
import { useLongPress } from '@/lib/useLongPress'
import { cn } from '@/lib/utils'
import type { DiaryEntry, ExerciseEntry, Meal } from '@/lib/database.types'

const MEALS: { key: Meal; label: string }[] = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snacks', label: 'Snacks' },
]

// Cold-load placeholder that mirrors the hero (ring + macro bars) and the meal
// cards, so the real layout fades in rather than flashing the empty/no-goal state.
function DiarySkeleton() {
  return (
    <>
      <Card className="p-4">
        <div className="flex items-center gap-4">
          <Skeleton className="h-[132px] w-[132px] rounded-full" />
          <div className="flex flex-1 flex-col items-end gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-2.5 w-12" />
              <Skeleton className="h-1.5 w-full" />
              <Skeleton className="h-2.5 w-10" />
            </div>
          ))}
        </div>
      </Card>
      {MEALS.map((m) => (
        <Card key={m.key} className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border p-3">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3 w-12" />
          </div>
          <div className="space-y-3 p-3">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </Card>
      ))}
    </>
  )
}

export function DiaryPage() {
  const nav = useNavigate()
  // Seed from ?date= so returning here from add-food keeps the day you were on;
  // a fresh Diary-tab tap (no param) still opens today.
  const [params] = useSearchParams()
  const [date, setDate] = useState(() => params.get('date') || todayISO())
  const { data: entries, isLoading: diaryLoading } = useDiary(date)
  const { data: profile, isLoading: profileLoading } = useProfile()
  const { data: weight } = useLatestWeight()
  const { data: exEntries } = useExerciseEntries(date)
  const { data: streak = 0 } = useStreak()
  const delEx = useDeleteExercise()
  const delEntry = useDeleteDiaryEntry()
  const delEntries = useDeleteDiaryEntries()
  const moveEntries = useMoveDiaryEntries()
  const copyEntries = useCopyEntriesToDay()
  const createMeal = useCreateMealFromEntries()
  const [menuEntry, setMenuEntry] = useState<DiaryEntry | null>(null)
  const [menuEx, setMenuEx] = useState<ExerciseEntry | null>(null)
  // Entries pending a meal move (single id or multi-select); `from` = current
  // meal, disabled in the picker (null when picks span meals).
  const [move, setMove] = useState<{ ids: string[]; from: Meal | null } | null>(
    null,
  )

  // Multi-select mode (food entries only).
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [action, setAction] = useState<null | 'meal' | 'copy'>(null)
  const [mealName, setMealName] = useState('')
  const [copyDate, setCopyDate] = useState(date)

  // Change the day with a directional slide animation. `dir` = 1 → the new
  // day slides in from the right (forward), -1 → from the left (back).
  const [dir, setDir] = useState(0)
  const step = (delta: number) => {
    setDir(delta)
    setDate((d) => addDaysISO(d, delta))
  }
  const jumpTo = (iso: string) => {
    if (!iso || iso === date) return
    setDir(iso > date ? 1 : -1)
    setDate(iso)
  }

  // Tappable date label → native date picker (jump to any day).
  const dateInput = useRef<HTMLInputElement>(null)
  const openDatePicker = () => {
    const el = dateInput.current
    if (!el) return
    try {
      el.showPicker()
    } catch {
      el.click()
    }
  }

  // Horizontal swipe changes the day (disabled while multi-selecting).
  const swipeStart = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (e: ReactTouchEvent) => {
    if (selectMode) return
    const t = e.touches[0]
    swipeStart.current = { x: t.clientX, y: t.clientY }
  }
  const onTouchEnd = (e: ReactTouchEvent) => {
    const s = swipeStart.current
    swipeStart.current = null
    if (!s || selectMode) return
    const t = e.changedTouches[0]
    const dx = t.clientX - s.x
    const dy = t.clientY - s.y
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5)
      step(dx < 0 ? 1 : -1)
  }

  // Cold-load skeleton: profile drives the "Set your goal" flash, entries the
  // meal lists. Both are isLoading only on the first fetch (no cached data).
  const loading = profileLoading || diaryLoading
  const list = entries ?? []
  const consumed = sumNutrients(
    list.map((e) => scaleNutrients(e.nutrients, e.servings)),
  )
  const goalRes = profile ? resolveCalorieGoal(profile, weight ?? null) : null
  const goal = goalRes?.goal ?? null
  const consumedKcal = Math.round(consumed.kcal ?? 0)
  const burned = (exEntries ?? []).reduce((s, e) => s + e.calories, 0)
  const macros =
    goal != null && profile
      ? resolveMacroTargets(goal, weight ?? null, profile.macro_targets)
      : null

  const selectedEntries = list.filter((e) => selectedIds.has(e.id))
  const count = selectedIds.size

  const enterSelect = (e?: DiaryEntry) => {
    setSelectMode(true)
    setSelectedIds(e ? new Set([e.id]) : new Set())
  }
  const exitSelect = () => {
    setSelectMode(false)
    setSelectedIds(new Set())
    setAction(null)
    setMealName('')
  }
  const toggleId = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const openCopy = () => {
    setCopyDate(addDaysISO(date, 1))
    setAction('copy')
  }

  const doSaveMeal = async () => {
    const name = mealName.trim()
    if (!name || selectedEntries.length === 0) return
    await createMeal.mutateAsync({ name, entries: selectedEntries })
    exitSelect()
  }

  const doCopy = async () => {
    if (selectedEntries.length === 0) return
    const n = await copyEntries.mutateAsync({
      to: copyDate,
      entries: selectedEntries,
    })
    exitSelect()
    if (n > 0) jumpTo(copyDate) // jump to the copied day so the result is visible
  }

  const doDelete = () => {
    if (count === 0) return
    if (
      !confirm(`Delete ${count} ${count === 1 ? 'entry' : 'entries'}?`)
    )
      return
    delEntries.mutate([...selectedIds])
    exitSelect()
  }

  const doMove = async (meal: Meal) => {
    if (!move || move.ids.length === 0) return
    moveEntries.mutate({ ids: move.ids, meal })
    setMove(null)
    exitSelect()
  }

  return (
    <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <PageHeader
        title={selectMode ? `${count} selected` : 'Diary'}
        subtitle={
          selectMode ? undefined : (
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={openDatePicker}
                aria-label="Change date"
                className="font-medium text-foreground underline decoration-dotted underline-offset-4"
              >
                {dateLabel(date)}
              </button>
              <input
                ref={dateInput}
                type="date"
                value={date}
                onChange={(e) => jumpTo(e.target.value)}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
              />
              {streak > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                  <Flame className="h-3.5 w-3.5" />
                  {streak}
                </span>
              )}
            </span>
          )
        }
        left={
          selectMode ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={exitSelect}
              aria-label="Cancel selection"
            >
              <X className="h-5 w-5" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => step(-1)}
              aria-label="Previous day"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )
        }
        action={
          selectMode ? undefined : (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => step(1)}
              aria-label="Next day"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          )
        }
      />

      <div
        key={date}
        className={cn(
          'space-y-4 overflow-x-clip p-4',
          selectMode && 'pb-28',
          dir > 0 && 'diary-slide-right',
          dir < 0 && 'diary-slide-left',
        )}
      >
        {loading ? (
          <DiarySkeleton />
        ) : (
          <>
        <Card className="p-4">
          {goal != null ? (
            <>
              <div className="flex items-center gap-4">
                <CalorieRing
                  consumed={consumedKcal}
                  goal={goal}
                  burned={burned}
                />
                <div className="flex-1 text-right text-xs text-muted-foreground">
                  <div>{goal} goal</div>
                  <div>− {consumedKcal} food</div>
                  {burned > 0 && <div>+ {burned} exercise</div>}
                </div>
              </div>
              {macros && (
                <div className="mt-4 grid grid-cols-3 gap-3">
                  {(['protein', 'carb', 'fat'] as const).map((k) => (
                    <MacroBar
                      key={k}
                      label={
                        k === 'carb' ? 'Carbs' : k[0].toUpperCase() + k.slice(1)
                      }
                      have={Math.round(consumed[k] ?? 0)}
                      target={macros[k].grams}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-muted-foreground">
              <span className="text-2xl font-bold text-foreground">
                {consumedKcal}
              </span>{' '}
              calories eaten.{' '}
              <button
                className="text-primary underline"
                onClick={() => nav('/profile')}
              >
                Set your goal
              </button>{' '}
              to track calories remaining.
            </div>
          )}
          <StepsRow date={date} />
          {list.length > 0 && (
            <button
              onClick={() => nav(`/diary/nutrients?date=${date}`)}
              className="mt-3 w-full text-center text-xs font-medium text-primary"
            >
              View full nutrient breakdown →
            </button>
          )}
        </Card>

        {MEALS.map((m) => {
          const items = list.filter((e) => e.meal === m.key)
          const mealKcal = Math.round(
            items.reduce((s, e) => s + (e.nutrients.kcal ?? 0) * e.servings, 0),
          )
          return (
            <Card key={m.key} className="overflow-hidden">
              <button
                type="button"
                disabled={items.length === 0}
                onClick={() =>
                  nav(`/diary/nutrients?date=${date}&meal=${m.key}`)
                }
                className="flex w-full items-center justify-between border-b border-border p-3 text-left active:bg-accent"
              >
                <span className="font-semibold">{m.label}</span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {mealKcal} calories
                  {items.length > 0 && <ChevronRight className="h-4 w-4" />}
                </span>
              </button>
              <div className="divide-y divide-border">
                {items.map((e) => (
                  <FoodEntryRow
                    key={e.id}
                    entry={e}
                    selectMode={selectMode}
                    selected={selectedIds.has(e.id)}
                    onEdit={() => nav(`/diary/entry/${e.id}`)}
                    onMenu={() => setMenuEntry(e)}
                    onToggle={() => toggleId(e.id)}
                  />
                ))}
              </div>
              {!selectMode && (
                <button
                  onClick={() => nav(`/diary/add?date=${date}&meal=${m.key}`)}
                  className="flex w-full items-center gap-2 p-3 text-sm font-medium text-primary active:bg-accent"
                >
                  <Plus className="h-4 w-4" /> Add food
                </button>
              )}
            </Card>
          )
        })}

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border p-3">
            <span className="font-semibold">Exercise</span>
            <span className="text-xs text-muted-foreground">{burned} calories</span>
          </div>
          <div className="divide-y divide-border">
            {(exEntries ?? []).map((e) => (
              <ExerciseEntryRow
                key={e.id}
                entry={e}
                onEdit={() => nav(`/exercise/edit/${e.id}`)}
                onMenu={() => setMenuEx(e)}
              />
            ))}
          </div>
          {!selectMode && (
            <button
              onClick={() => nav(`/exercise/add?date=${date}`)}
              className="flex w-full items-center gap-2 p-3 text-sm font-medium text-primary active:bg-accent"
            >
              <Plus className="h-4 w-4" /> Add exercise
            </button>
          )}
        </Card>
          </>
        )}
      </div>

      {selectMode && (
        <div className="fixed bottom-0 left-1/2 z-50 w-full max-w-md -translate-x-1/2 border-t border-border bg-card p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
          <div className="grid grid-cols-4 gap-1">
            <SelectAction
              icon={ArrowRightLeft}
              label="Move"
              onClick={() => setMove({ ids: [...selectedIds], from: null })}
              disabled={count === 0}
            />
            <SelectAction
              icon={BookmarkPlus}
              label="Save as meal"
              onClick={() => setAction('meal')}
              disabled={count === 0}
            />
            <SelectAction
              icon={Copy}
              label="Copy to day"
              onClick={openCopy}
              disabled={count === 0}
            />
            <SelectAction
              icon={Trash2}
              label="Delete"
              onClick={doDelete}
              disabled={count === 0}
              destructive
            />
          </div>
        </div>
      )}

      {menuEntry && (
        <ActionSheet
          title={menuEntry.food_name}
          onSelect={() => {
            enterSelect(menuEntry)
            setMenuEntry(null)
          }}
          onMove={() => {
            setMove({ ids: [menuEntry.id], from: menuEntry.meal })
            setMenuEntry(null)
          }}
          onEdit={() => {
            nav(`/diary/entry/${menuEntry.id}`)
            setMenuEntry(null)
          }}
          onDelete={() => {
            delEntry.mutate(menuEntry.id)
            setMenuEntry(null)
          }}
          onClose={() => setMenuEntry(null)}
        />
      )}

      {menuEx && (
        <ActionSheet
          title={menuEx.name}
          onEdit={() => {
            nav(`/exercise/edit/${menuEx.id}`)
            setMenuEx(null)
          }}
          onDelete={() => {
            delEx.mutate(menuEx.id)
            setMenuEx(null)
          }}
          onClose={() => setMenuEx(null)}
        />
      )}

      {action === 'meal' &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
            onClick={() => setAction(null)}
          >
            <div
              className="mx-auto w-full max-w-md p-3"
              onClick={(ev) => ev.stopPropagation()}
            >
              <Card className="overflow-hidden">
                <div className="border-b border-border p-3 text-center text-sm font-medium">
                  Save as meal
                </div>
                <div className="space-y-3 p-4">
                  <p className="text-xs text-muted-foreground">
                    {count} {count === 1 ? 'item' : 'items'} from{' '}
                    {dateLabel(date)}
                  </p>
                  <Input
                    autoFocus
                    placeholder="Meal name (e.g. Usual breakfast)"
                    value={mealName}
                    onChange={(e) => setMealName(e.target.value)}
                  />
                  <Button
                    className="w-full"
                    disabled={!mealName.trim() || createMeal.isPending}
                    onClick={doSaveMeal}
                  >
                    {createMeal.isPending ? 'Saving…' : 'Save meal'}
                  </Button>
                </div>
              </Card>
              <button
                onClick={() => setAction(null)}
                className="mt-2 w-full rounded-xl bg-card p-4 text-sm font-medium active:bg-accent"
              >
                Cancel
              </button>
            </div>
          </div>,
          document.body,
        )}

      {action === 'copy' &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
            onClick={() => setAction(null)}
          >
            <div
              className="mx-auto w-full max-w-md p-3"
              onClick={(ev) => ev.stopPropagation()}
            >
              <Card className="overflow-hidden">
                <div className="border-b border-border p-3 text-center text-sm font-medium">
                  Copy {count} {count === 1 ? 'item' : 'items'} to another day
                </div>
                <div className="space-y-3 p-4">
                  <input
                    type="date"
                    value={copyDate}
                    onChange={(e) => setCopyDate(e.target.value)}
                    className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                  />
                  <Button
                    className="w-full"
                    disabled={copyEntries.isPending}
                    onClick={doCopy}
                  >
                    {copyEntries.isPending ? 'Copying…' : 'Copy'}
                  </Button>
                </div>
              </Card>
              <button
                onClick={() => setAction(null)}
                className="mt-2 w-full rounded-xl bg-card p-4 text-sm font-medium active:bg-accent"
              >
                Cancel
              </button>
            </div>
          </div>,
          document.body,
        )}

      {move &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
            onClick={() => setMove(null)}
          >
            <div
              className="mx-auto w-full max-w-md p-3"
              onClick={(ev) => ev.stopPropagation()}
            >
              <Card className="overflow-hidden">
                <div className="border-b border-border p-3 text-center text-sm font-medium">
                  Move {move.ids.length}{' '}
                  {move.ids.length === 1 ? 'item' : 'items'} to…
                </div>
                {MEALS.map((m) => (
                  <button
                    key={m.key}
                    disabled={m.key === move.from || moveEntries.isPending}
                    onClick={() => doMove(m.key)}
                    className="flex w-full items-center justify-between border-b border-border p-4 text-left text-sm font-medium last:border-b-0 active:bg-accent disabled:opacity-40"
                  >
                    {m.label}
                    {m.key === move.from && (
                      <span className="text-xs text-muted-foreground">
                        current
                      </span>
                    )}
                  </button>
                ))}
              </Card>
              <button
                onClick={() => setMove(null)}
                className="mt-2 w-full rounded-xl bg-card p-4 text-sm font-medium active:bg-accent"
              >
                Cancel
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

const ROW_CLASS =
  'flex w-full select-none items-center gap-2 p-3 text-left [-webkit-touch-callout:none] active:bg-accent'

function FoodEntryRow({
  entry,
  selectMode,
  selected,
  onEdit,
  onMenu,
  onToggle,
}: {
  entry: DiaryEntry
  selectMode: boolean
  selected: boolean
  onEdit: () => void
  onMenu: () => void
  onToggle: () => void
}) {
  const press = useLongPress(onMenu, onEdit)
  const body = (
    <div className="min-w-0 flex-1">
      <div className="truncate text-sm font-medium">{entry.food_name}</div>
      <div className="text-xs text-muted-foreground">
        {Math.round((entry.nutrients.kcal ?? 0) * entry.servings)} calories
      </div>
    </div>
  )
  if (selectMode) {
    return (
      <button
        onClick={onToggle}
        className={cn(ROW_CLASS, selected && 'bg-accent')}
      >
        {selected ? (
          <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
        ) : (
          <Circle className="h-5 w-5 shrink-0 text-muted-foreground/40" />
        )}
        {body}
      </button>
    )
  }
  return (
    <button {...press} className={ROW_CLASS}>
      {body}
    </button>
  )
}

function ExerciseEntryRow({
  entry,
  onEdit,
  onMenu,
}: {
  entry: ExerciseEntry
  onEdit: () => void
  onMenu: () => void
}) {
  const press = useLongPress(onMenu, onEdit)
  return (
    <button {...press} className={ROW_CLASS}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{entry.name}</div>
        <div className="text-xs text-muted-foreground">
          {entry.duration_min ? `${entry.duration_min} min` : ''}
          {entry.distance_mi ? ` · ${entry.distance_mi} mi` : ''} ·{' '}
          {entry.calories} calories
        </div>
        <ZoneBadge zone={entry.zone} avgHr={entry.avg_hr} className="mt-1" />
      </div>
    </button>
  )
}

function SelectAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  destructive,
}: {
  icon: typeof Trash2
  label: string
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex flex-col items-center gap-1 rounded-lg py-2 text-xs font-medium active:bg-accent disabled:opacity-40',
        destructive ? 'text-destructive' : 'text-foreground',
      )}
    >
      <Icon className="h-5 w-5" />
      {label}
    </button>
  )
}

function MacroBar({
  label,
  have,
  target,
}: {
  label: string
  have: number
  target: number
}) {
  const pct = target > 0 ? Math.min(100, Math.round((have / target) * 100)) : 0
  return (
    <div className="text-center">
      <div className="text-xs font-medium">{label}</div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full"
          style={{ width: `${pct}%`, background: RING_GREEN }}
        />
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {have}/{target}g
      </div>
    </div>
  )
}

// Passive step count from Health Connect (native Android only). Renders nothing
// on web / older APKs / when Health Connect is unavailable. Before the READ_STEPS
// grant it shows a "Connect steps" tap; after, the day's total. Display-only.
function StepsRow({ date }: { date: string }) {
  const { data } = useSteps(date)
  const connect = useConnectSteps(date)
  if (!data || data.status === 'unavailable') return null
  if (data.status === 'no_permission') {
    return (
      <button
        onClick={() => connect.mutate()}
        disabled={connect.isPending}
        className="mt-3 flex w-full items-center justify-center gap-1.5 border-t border-border pt-3 text-xs font-medium text-primary disabled:opacity-60"
      >
        <Footprints className="h-4 w-4" />
        {connect.isPending ? 'Connecting…' : 'Connect steps'}
      </button>
    )
  }
  return (
    <div className="mt-3 flex items-center justify-center gap-1.5 border-t border-border pt-3 text-sm text-muted-foreground">
      <Footprints className="h-4 w-4" />
      <span className="font-semibold text-foreground">
        {(data.steps ?? 0).toLocaleString()}
      </span>{' '}
      steps
    </div>
  )
}
