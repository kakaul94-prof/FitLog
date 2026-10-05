import { useQuery } from '@tanstack/react-query'
import { Capacitor } from '@capacitor/core'
import { supabase } from '@/lib/supabase'
import { addDaysISO, todayISO } from '@/lib/date'
import { goalForDate, resolveCalorieGoal, resolveMacroTargets } from '@/lib/calc'
import { cardioGoalTotal, resolveCardioGoal } from '@/lib/cardioGoal'
import { readSteps } from '@/lib/stepsNative'
import {
  buildReport,
  coveredEnd,
  type ReportDay,
  type ReportPeriod,
  type ReportResult,
} from '@/lib/report'
import { REGION_IDS, REGION_LABEL, resolveGoals } from '@/data/bodyMap'
import { EXERCISES } from '@/data/exercises'
import { useProfile } from '@/features/profile/useProfile'
import { useLatestWeight } from '@/features/measurements/useMeasurements'
import { useMuscleVolume } from '@/features/strength/useMuscleVolume'
import { useCustomExercises } from '@/features/strength/useCustomExercises'
import type { MicroRow } from '@/features/insights/useMicronutrientTrends'
import type { Nutrients } from '@/lib/database.types'

interface ReportRows {
  diary: MicroRow[]
  exercise: { entry_date: string; calories: number | null; duration_min: number | null }[]
  workoutDates: string[]
}

async function fetchReportRows(start: string, end: string): Promise<ReportRows> {
  const [diary, exercise, workouts] = await Promise.all([
    supabase
      .from('diary_entries')
      .select('entry_date,nutrients,servings')
      .gte('entry_date', start)
      .lte('entry_date', end),
    supabase
      .from('exercise_entries')
      .select('entry_date,calories,duration_min')
      .gte('entry_date', start)
      .lte('entry_date', end),
    supabase
      .from('workouts')
      .select('workout_date')
      .gte('workout_date', start)
      .lte('workout_date', end),
  ])
  if (diary.error) throw diary.error
  if (exercise.error) throw exercise.error
  if (workouts.error) throw workouts.error
  return {
    diary: (diary.data ?? []) as MicroRow[],
    exercise: (exercise.data ?? []) as ReportRows['exercise'],
    workoutDates: ((workouts.data ?? []) as { workout_date: string }[]).map(
      (w) => w.workout_date,
    ),
  }
}

/** Health Connect keeps steps on the device, so read each day. A 0 reading is
 *  treated as no data (phone not carried / before sync), not a zero-step day. */
async function readStepsRange(start: string, end: string): Promise<Record<string, number>> {
  const dates: string[] = []
  for (let d = start; d <= end; d = addDaysISO(d, 1)) dates.push(d)
  const results = await Promise.all(dates.map((d) => readSteps(d)))
  const out: Record<string, number> = {}
  results.forEach((r, i) => {
    if (r?.status === 'ok' && r.steps != null && r.steps > 0) out[dates[i]] = r.steps
  })
  return out
}

const addTo = (m: Map<string, number>, key: string, n: number) =>
  m.set(key, (m.get(key) ?? 0) + n)

/**
 * Goals scorecard for a period — every goal the app already tracks, rolled up
 * over the days covered so far (see lib/report.ts). Shared by the Progress
 * "Last week" card and the Week/Month in review page.
 */
export function useReportGoals(period: ReportPeriod): {
  report: ReportResult | null
  rows: ReportRows | undefined
  isLoading: boolean
  isError: boolean
} {
  const today = todayISO()
  const end = coveredEnd(period, today)
  const { data: profile, isLoading: profileLoading } = useProfile()
  const { data: weight } = useLatestWeight()
  const rows = useQuery({
    queryKey: ['report', period.start, end],
    queryFn: () => fetchReportRows(period.start, end),
    // Backfilling a day should show up the next time you open the report.
    refetchOnMount: 'always',
  })
  const volume = useMuscleVolume(period.start, end)
  const stepGoal = profile?.step_goal ?? null
  const steps = useQuery({
    queryKey: ['reportSteps', period.start, end],
    queryFn: () => readStepsRange(period.start, end),
    enabled: Capacitor.isNativePlatform() && !!stepGoal,
  })

  const isLoading = profileLoading || rows.isLoading || volume.isLoading || steps.isLoading
  const isError = rows.isError || volume.isError
  if (!profile || !rows.data || !volume.data)
    return { report: null, rows: rows.data, isLoading, isError }

  const liveGoal = resolveCalorieGoal(profile, weight ?? null).goal
  const food = new Map<string, { kcal: number; protein: number }>()
  for (const r of rows.data.diary) {
    const n: Nutrients = r.nutrients ?? {}
    const s = r.servings ?? 0
    const cur = food.get(r.entry_date) ?? { kcal: 0, protein: 0 }
    cur.kcal += (n.kcal ?? 0) * s
    cur.protein += (n.protein ?? 0) * s
    food.set(r.entry_date, cur)
  }
  const burned = new Map<string, number>()
  const cardioMin = new Map<string, number>()
  for (const e of rows.data.exercise) {
    addTo(burned, e.entry_date, e.calories ?? 0)
    if ((e.duration_min ?? 0) > 0) addTo(cardioMin, e.entry_date, e.duration_min as number)
  }
  const workouts = new Map<string, number>()
  for (const d of rows.data.workoutDates) addTo(workouts, d, 1)
  const mobility = profile.program?.mobility
  const mobilitySec = new Map<string, number>()
  for (const e of mobility?.log ?? [])
    if (e.date >= period.start && e.date <= end) addTo(mobilitySec, e.date, e.seconds)

  const days: ReportDay[] = []
  for (let date = period.start; date <= end; date = addDaysISO(date, 1)) {
    // The goal in effect that day, so a mid-period goal change scores honestly.
    const calorieGoal = goalForDate(profile.calorie_goal_history, date, liveGoal, today)
    const f = food.get(date)
    days.push({
      date,
      logged: !!f,
      kcal: f?.kcal ?? 0,
      protein: f?.protein ?? 0,
      burned: burned.get(date) ?? 0,
      calorieGoal,
      proteinTarget:
        calorieGoal != null
          ? resolveMacroTargets(calorieGoal, weight ?? null, profile.macro_targets).protein.grams
          : null,
      cardioMin: cardioMin.get(date) ?? 0,
      workouts: workouts.get(date) ?? 0,
      mobilitySec: mobilitySec.get(date) ?? 0,
      steps: steps.data?.[date] ?? null,
    })
  }

  const cardioGoal = resolveCardioGoal(profile.cardio_goal, profile.weekly_cardio_min_target)
  const setGoals = resolveGoals(profile.volume_targets)
  const setsByRegion = volume.data.byRegion
  const report = buildReport({
    period,
    today,
    days,
    cardioWeeklyMin: cardioGoal ? cardioGoalTotal(cardioGoal) : null,
    stepGoal,
    mobilityWeeklySec: (mobility?.stretches ?? []).reduce(
      (s, st) => s + Math.max(0, st.targetMin) * 60,
      0,
    ),
    muscles: REGION_IDS.filter((r) => setGoals[r] > 0).map((r) => ({
      label: REGION_LABEL[r],
      sets: setsByRegion[r] ?? 0,
      weeklyGoal: setGoals[r],
    })),
  })
  return { report, rows: rows.data, isLoading, isError }
}

export interface PeriodPR {
  key: string
  name: string
  weight: number
}

/** Lifts whose heaviest set this period beat everything logged before it.
 *  First-ever lifts don't count — there's nothing to beat yet. */
async function fetchPeriodPRs(start: string, end: string): Promise<Omit<PeriodPR, 'name'>[]> {
  const { data: ws, error: we } = await supabase
    .from('workouts')
    .select('id')
    .gte('workout_date', start)
    .lte('workout_date', end)
  if (we) throw we
  const ids = ((ws ?? []) as { id: string }[]).map((w) => w.id)
  if (!ids.length) return []
  const { data: sets, error: se } = await supabase
    .from('workout_sets')
    .select('exercise_key,weight_lb')
    .in('workout_id', ids)
    .gt('weight_lb', 0)
  if (se) throw se
  const best = new Map<string, number>()
  for (const s of (sets ?? []) as { exercise_key: string; weight_lb: number }[])
    if (s.weight_lb > (best.get(s.exercise_key) ?? 0)) best.set(s.exercise_key, s.weight_lb)
  // One tiny ordered query per lift rather than pulling all history (row caps).
  const checks = await Promise.all(
    [...best].map(async ([key, weight]) => {
      const { data, error } = await supabase
        .from('workout_sets')
        .select('weight_lb,workouts!inner(workout_date)')
        .eq('exercise_key', key)
        .lt('workouts.workout_date', start)
        .gt('weight_lb', 0)
        .order('weight_lb', { ascending: false })
        .limit(1)
      if (error) throw error
      const prior = ((data ?? [])[0] as { weight_lb: number } | undefined)?.weight_lb ?? 0
      return prior > 0 && weight > prior ? { key, weight } : null
    }),
  )
  return checks
    .filter((c): c is Omit<PeriodPR, 'name'> => c != null)
    .sort((a, b) => b.weight - a.weight)
}

export function usePeriodPRs(period: ReportPeriod): PeriodPR[] {
  const end = coveredEnd(period, todayISO())
  const { data: custom } = useCustomExercises()
  const { data } = useQuery({
    queryKey: ['reportPRs', period.start, end],
    queryFn: () => fetchPeriodPRs(period.start, end),
  })
  const nameFor = (key: string) =>
    EXERCISES.find((e) => e.key === key)?.name ??
    custom?.find((c) => `custom:${c.id}` === key)?.name ??
    key
  return (data ?? []).map((p) => ({ ...p, name: nameFor(p.key) }))
}
