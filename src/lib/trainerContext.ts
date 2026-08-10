import { supabase } from './supabase'
import { todayISO, addDaysISO, daysBetweenISO } from './date'
import {
  estimateAdaptiveTDEE,
  estimated1RM,
  resolveCalorieGoal,
  resolveMacroTargets,
} from './calc'
import { NUTRIENT_BY_KEY, scaleNutrients, sumNutrients } from './nutrients'
import type {
  Food,
  Nutrients,
  Profile,
  StrengthGoal,
} from './database.types'

// Builds the plain-text snapshot of the user's own training that gets sent up
// with every trainer question (functions/api/trainer.ts). This is the whole
// reason the chat can say "your squat has sat at 225 for three sessions"
// instead of giving generic advice — the model has no memory and no database
// access, so anything it should know has to be in here.
//
// Design constraints:
// - Compact. Every character is an input token on each turn; the endpoint caps
//   this at 8000 chars. Prefer a summarised line over raw rows.
// - Recent. 90 days of lifting is plenty of context for "what should I do next".
// - Honest. Omit a section entirely when there's no data rather than writing
//   "none" — a missing heading reads as "unknown", which is the truth.

const LIFT_WINDOW_DAYS = 90
const PAIN_WINDOW_DAYS = 60
const CARDIO_WINDOW_DAYS = 14
/** Matches the adaptive-TDEE default window, so the numbers agree with Insights. */
const NUTRITION_WINDOW_DAYS = 28
/** Second, shorter intake window — catches a change of gear the 28-day average hides. */
const RECENT_NUTRITION_DAYS = 7
/** Lifts to detail, most-trained first. Enough to cover a full rotation. */
const MAX_LIFTS = 8
/** Sessions of history per lift. Enough to read a stall or a climb. */
const MAX_SESSIONS_PER_LIFT = 4
/** Weigh-in history to pull: covers the bodyweight trend and the TDEE window. */
const WEIGHT_WINDOW_DAYS = 120

/** Micros worth reporting to a lifter, in the order they get rendered. Iron,
 *  vitamin D and magnesium carry real fatigue/recovery implications; the rest
 *  are the ones a lifting diet commonly misses. */
const MICRO_KEYS = [
  'fiber',
  'iron',
  'calcium',
  'vit_d',
  'potassium',
  'magnesium',
  'zinc',
  'b12',
] as const

/** Below this many logged days the micro averages are noise, so they're omitted
 *  rather than shown with a caveat nobody reads. */
const MIN_DAYS_FOR_MICROS = 5

interface SetRow {
  workout_id: string
  exercise_key: string
  exercise_name: string
  reps: number | null
  weight_lb: number | null
  effort: number | null
  is_warmup: boolean
  feel?: 'good' | 'off' | null
  pain?: string | null
}

const lb = (n: number) => `${Math.round(n)} lb`

/** "205x5, 205x5, 205x4" — how a session actually went, in the fewest chars. */
function describeSets(sets: SetRow[]): string {
  return sets
    .map((s) => {
      const w = s.weight_lb != null && s.weight_lb > 0 ? Math.round(s.weight_lb) : null
      const r = s.reps ?? 0
      const base = w != null ? `${w}x${r}` : `${r} reps`
      const flags = [
        s.effort != null ? `RPE${s.effort}` : '',
        s.feel === 'off' ? 'form off' : '',
        s.pain ? `PAIN:${s.pain}` : '',
      ].filter(Boolean)
      return flags.length ? `${base} (${flags.join(', ')})` : base
    })
    .join(', ')
}

function ageFrom(birth: string | null): number | null {
  if (!birth) return null
  const years = daysBetweenISO(birth, todayISO()) / 365.25
  return years > 0 && years < 120 ? Math.floor(years) : null
}

export async function buildTrainerContext(
  /** `workoutId` = the chat was opened from inside a live workout, which adds a
   *  "right now" section and tells the model to keep answers short. */
  opts: { workoutId?: string } = {},
): Promise<string> {
  const today = todayISO()
  const liftSince = addDaysISO(today, -LIFT_WINDOW_DAYS)
  const cardioSince = addDaysISO(today, -CARDIO_WINDOW_DAYS)
  const painSince = addDaysISO(today, -PAIN_WINDOW_DAYS)

  const nutritionSince = addDaysISO(today, -NUTRITION_WINDOW_DAYS)
  const recentSince = addDaysISO(today, -RECENT_NUTRITION_DAYS)

  const [
    profileRes,
    workoutsRes,
    weightRes,
    goalsRes,
    cardioRes,
    routinesRes,
    diaryRes,
  ] = await Promise.all([
    supabase.from('profiles').select('*').maybeSingle(),
    supabase
      .from('workouts')
      .select('id,workout_date,name')
      .gte('workout_date', liftSince)
      .order('workout_date', { ascending: false }),
    supabase
      .from('measurements')
      .select('measured_on,value,unit')
      .eq('type', 'weight')
      .gte('measured_on', addDaysISO(today, -WEIGHT_WINDOW_DAYS))
      .order('measured_on', { ascending: false }),
    supabase.from('strength_goals').select('*'),
    supabase
      .from('exercise_entries')
      .select('entry_date,name,duration_min,distance_mi,zone')
      .gte('entry_date', cardioSince)
      .order('entry_date', { ascending: false }),
    supabase.from('routines').select('id,name'),
    supabase
      .from('diary_entries')
      .select('entry_date,nutrients,servings')
      .gte('entry_date', nutritionSince),
  ])

  const profile = profileRes.data as Profile | null
  const workouts = (workoutsRes.data ?? []) as {
    id: string
    workout_date: string
    name: string | null
  }[]
  const weights = (weightRes.data ?? []) as {
    measured_on: string
    value: number
    unit: string
  }[]
  const goals = (goalsRes.data ?? []) as StrengthGoal[]
  const cardio = (cardioRes.data ?? []) as {
    entry_date: string
    name: string
    duration_min: number | null
    distance_mi: number | null
    zone: number | null
  }[]
  const routines = (routinesRes.data ?? []) as { id: string; name: string }[]
  const diary = (diaryRes.data ?? []) as {
    entry_date: string
    nutrients: Nutrients | null
    servings: number
  }[]

  // Supplement names only — the point is to stop the model reading a micro gap
  // as a dietary hole when a multivitamin is already covering it.
  let supplementNames: string[] = []
  const supplementIds = (profile?.daily_supplements ?? []).map((s) => s.food_id)
  if (supplementIds.length) {
    const { data } = await supabase
      .from('foods')
      .select('id,name')
      .in('id', supplementIds)
    supplementNames = ((data ?? []) as Pick<Food, 'id' | 'name'>[]).map(
      (f) => f.name,
    )
  }

  // Sets for the in-window workouts. Done second because it needs their ids;
  // skipped entirely when nothing has been logged.
  let sets: SetRow[] = []
  if (workouts.length) {
    const { data } = await supabase
      .from('workout_sets')
      .select(
        'workout_id,exercise_key,exercise_name,reps,weight_lb,effort,is_warmup,feel,pain',
      )
      .in(
        'workout_id',
        workouts.map((w) => w.id),
      )
    sets = (data ?? []) as SetRow[]
  }

  const dateOf = new Map(workouts.map((w) => [w.id, w.workout_date] as const))
  const working = sets.filter((s) => !s.is_warmup)

  const out: string[] = [`Today is ${today}.`]

  // --- The live workout ---------------------------------------------------
  // Goes first: when the chat is opened mid-session this is the most relevant
  // thing in the whole snapshot, and putting it up top also keeps it clear of
  // the endpoint's context cap.
  if (opts.workoutId) {
    const current = workouts.find((w) => w.id === opts.workoutId)
    const { data: wexData } = await supabase
      .from('workout_exercises')
      .select('exercise_key,exercise_name,position')
      .eq('workout_id', opts.workoutId)
      .order('position')
    const planned = (wexData ?? []) as {
      exercise_key: string
      exercise_name: string
      position: number
    }[]

    const todaySets = working.filter((s) => s.workout_id === opts.workoutId)
    const doneByKey = new Map<string, SetRow[]>()
    for (const s of todaySets) {
      const arr = doneByKey.get(s.exercise_key) ?? []
      arr.push(s)
      doneByKey.set(s.exercise_key, arr)
    }

    const lines = [
      `MID-WORKOUT RIGHT NOW: "${current?.name ?? 'Workout'}". They are in the gym, between sets — keep the answer short.`,
    ]
    // Walk the template order so "what's next" is answerable.
    const order = planned.length
      ? planned
      : [...doneByKey.keys()].map((k, i) => ({
          exercise_key: k,
          exercise_name: doneByKey.get(k)![0].exercise_name,
          position: i,
        }))
    const done: string[] = []
    const todo: string[] = []
    for (const ex of order) {
      const rows = doneByKey.get(ex.exercise_key)
      if (rows?.length) done.push(`    ${ex.exercise_name}: ${describeSets(rows)}`)
      else todo.push(ex.exercise_name)
    }
    lines.push(
      done.length
        ? `Logged so far this session:\n${done.join('\n')}`
        : 'Nothing logged this session yet.',
    )
    if (todo.length) lines.push(`Still to do on today's list: ${todo.join(', ')}.`)
    out.push(lines.join('\n'))
  }

  // --- Who they are -------------------------------------------------------
  const bio: string[] = []
  const age = ageFrom(profile?.birth_date ?? null)
  if (age) bio.push(`${age}y`)
  if (profile?.sex) bio.push(profile.sex)
  if (profile?.height_cm) bio.push(`${Math.round(profile.height_cm)} cm`)
  const latestWeight = weights[0]
  if (latestWeight) bio.push(`${Math.round(latestWeight.value)} ${latestWeight.unit}`)
  if (bio.length) out.push(`Lifter: ${bio.join(', ')}.`)

  // Bodyweight direction over the logged window — one line, not 30 readings.
  if (weights.length >= 3) {
    const oldest = weights[weights.length - 1]
    const delta = latestWeight.value - oldest.value
    const span = daysBetweenISO(oldest.measured_on, latestWeight.measured_on)
    if (span >= 7)
      out.push(
        `Bodyweight ${delta >= 0 ? 'up' : 'down'} ${Math.abs(delta).toFixed(1)} ${
          latestWeight.unit
        } over the last ${span} days.`,
      )
  }

  // --- Training frequency -------------------------------------------------
  if (workouts.length) {
    const last14 = workouts.filter(
      (w) => daysBetweenISO(w.workout_date, today) <= 14,
    ).length
    out.push(
      `Lifting sessions: ${workouts.length} in the last ${LIFT_WINDOW_DAYS} days, ${last14} in the last 14. Most recent was ${
        workouts[0].workout_date
      }${workouts[0].name ? ` (${workouts[0].name})` : ''}.`,
    )
  } else {
    out.push('No lifting sessions logged in the last 90 days.')
  }

  // --- Program ------------------------------------------------------------
  const program = profile?.program
  if (program?.sequence?.length) {
    const nameById = new Map(routines.map((r) => [r.id, r.name] as const))
    const rotation = program.sequence
      .map((item) =>
        item.kind === 'routine'
          ? (nameById.get(item.routineId) ?? 'workout')
          : 'rest',
      )
      .join(' → ')
    out.push(`Program rotation: ${rotation}.`)
  }

  // --- Per-lift history ---------------------------------------------------
  if (working.length) {
    const byLift = new Map<string, SetRow[]>()
    for (const s of working) {
      const arr = byLift.get(s.exercise_key) ?? []
      arr.push(s)
      byLift.set(s.exercise_key, arr)
    }
    const ranked = [...byLift.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, MAX_LIFTS)

    const lines: string[] = []
    for (const [, rows] of ranked) {
      const name = rows[0].exercise_name
      // Group this lift's sets by session, newest first.
      const bySession = new Map<string, SetRow[]>()
      for (const r of rows) {
        const d = dateOf.get(r.workout_id)
        if (!d) continue
        const arr = bySession.get(d) ?? []
        arr.push(r)
        bySession.set(d, arr)
      }
      const sessions = [...bySession.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .slice(0, MAX_SESSIONS_PER_LIFT)
      if (!sessions.length) continue

      const best = rows.reduce((m, r) => {
        const w = r.weight_lb ?? 0
        const reps = r.reps ?? 0
        return w > 0 && reps > 0 ? Math.max(m, estimated1RM(w, reps)) : m
      }, 0)

      lines.push(
        `${name}${best > 0 ? ` — best est 1RM ${lb(best)}` : ''}\n` +
          sessions
            .map(([date, ss]) => `    ${date}: ${describeSets(ss)}`)
            .join('\n'),
      )
    }
    if (lines.length)
      out.push(`Lifts (most trained first, recent sessions):\n${lines.join('\n')}`)
  }

  // --- Pain flags ---------------------------------------------------------
  // Surfaced separately because "my knee hurts" is the question this feature
  // exists for, and it must not get lost inside the per-lift dump.
  const painRows = sets
    .filter((s) => s.pain)
    .map((s) => ({ ...s, date: dateOf.get(s.workout_id) ?? '' }))
    .filter((s) => s.date >= painSince)
    .sort((a, b) => b.date.localeCompare(a.date))
  if (painRows.length) {
    const seen = new Set<string>()
    const notes: string[] = []
    for (const p of painRows) {
      const k = `${p.exercise_name}|${p.pain}`
      if (seen.has(k)) continue
      seen.add(k)
      notes.push(`${p.pain} on ${p.exercise_name} (${p.date})`)
      if (notes.length >= 8) break
    }
    out.push(
      `Pain flagged on logged sets in the last ${PAIN_WINDOW_DAYS} days: ${notes.join('; ')}.`,
    )
  }

  // --- Goals --------------------------------------------------------------
  const openGoals = goals.filter((g) => !g.achieved_at)
  if (openGoals.length)
    out.push(
      `Strength goals: ${openGoals
        .map(
          (g) =>
            `${g.exercise_name} to ${lb(g.target_weight_lb)}x${g.target_reps}${
              g.target_date ? ` by ${g.target_date}` : ''
            }`,
        )
        .join('; ')}.`,
    )

  // --- Cardio -------------------------------------------------------------
  if (cardio.length) {
    const minutes = cardio.reduce((s, c) => s + (c.duration_min ?? 0), 0)
    const kinds = [...new Set(cardio.map((c) => c.name))].slice(0, 5).join(', ')
    out.push(
      `Cardio in the last ${CARDIO_WINDOW_DAYS} days: ${cardio.length} sessions, ${Math.round(
        minutes,
      )} min total (${kinds}).`,
    )
  }

  // --- Nutrition ----------------------------------------------------------
  // A large share of training questions ("why have I stalled?", "why am I
  // flat?") are fuelling questions in disguise, so this block matters as much
  // as the lift history above.
  const weightLb = latestWeight?.value ?? null

  // Per-day totals. diary_entries snapshot nutrients PER SERVING, so each row
  // scales by its own servings before the day is summed.
  const byDay = new Map<string, Nutrients[]>()
  for (const row of diary) {
    if (!row.nutrients) continue
    const arr = byDay.get(row.entry_date) ?? []
    arr.push(scaleNutrients(row.nutrients, row.servings ?? 0))
    byDay.set(row.entry_date, arr)
  }
  const days = [...byDay.entries()]
    .map(([date, parts]) => ({ date, totals: sumNutrients(parts) }))
    .filter((d) => (d.totals.kcal ?? 0) > 0)
    .sort((a, b) => a.date.localeCompare(b.date))

  const nutrition: string[] = []

  // Goal + intent, which frame everything else. Worth stating even with no food
  // logged — "cutting at 1 lb/week" explains a lot about a stalling lift.
  const goalResult = profile
    ? resolveCalorieGoal(profile, weightLb)
    : null
  if (goalResult?.goal) {
    const intent =
      profile?.goal_type === 'lose'
        ? `cutting at ${profile.goal_rate_lb_per_week} lb/week`
        : profile?.goal_type === 'gain'
          ? `gaining at ${profile.goal_rate_lb_per_week} lb/week`
          : 'maintaining'
    nutrition.push(
      `Calorie goal: ${Math.round(goalResult.goal)}/day (${goalResult.mode}, ${intent}).`,
    )
    if (profile?.macro_targets && weightLb) {
      const m = resolveMacroTargets(goalResult.goal, weightLb, profile.macro_targets)
      nutrition.push(
        `Macro targets: ${Math.round(m.protein.grams)} g protein, ${Math.round(
          m.carb.grams,
        )} g carb, ${Math.round(m.fat.grams)} g fat.`,
      )
    }
  }

  if (days.length) {
    const avgOf = (rows: typeof days, key: keyof Nutrients) =>
      rows.length
        ? rows.reduce((s, d) => s + (d.totals[key] ?? 0), 0) / rows.length
        : 0

    const recent = days.filter((d) => d.date >= recentSince)
    const avgKcal = avgOf(days, 'kcal')
    const avgProtein = avgOf(days, 'protein')

    nutrition.push(
      `Food logged on ${days.length} of the last ${NUTRITION_WINDOW_DAYS} days. On those days: ${Math.round(
        avgKcal,
      )} kcal, ${Math.round(avgProtein)} g protein${
        weightLb ? ` (${(avgProtein / weightLb).toFixed(2)} g/lb bodyweight)` : ''
      }, ${Math.round(avgOf(days, 'carb'))} g carb, ${Math.round(
        avgOf(days, 'fat'),
      )} g fat per day.`,
    )
    if (recent.length >= 2)
      nutrition.push(
        `Last ${RECENT_NUTRITION_DAYS} days (${recent.length} logged): ${Math.round(
          avgOf(recent, 'kcal'),
        )} kcal, ${Math.round(avgOf(recent, 'protein'))} g protein per day.`,
      )

    // Measured maintenance beats the calculator — it's derived from what they
    // actually ate against what their weight actually did.
    const tdee = estimateAdaptiveTDEE(
      days.map((d) => ({ date: d.date, kcal: d.totals.kcal ?? 0 })),
      [...weights]
        .reverse()
        .filter((w) => w.measured_on >= nutritionSince)
        .map((w) => ({ date: w.measured_on, value: w.value })),
    )
    if (tdee.enough && tdee.tdee)
      nutrition.push(
        `Measured maintenance (from intake vs weight change): ${Math.round(
          tdee.tdee,
        )} kcal/day, weight trending ${tdee.trendLbPerWeek! >= 0 ? '+' : ''}${tdee.trendLbPerWeek!.toFixed(
          2,
        )} lb/week. This is more reliable than the calculated goal.`,
      )

    if (days.length >= MIN_DAYS_FOR_MICROS) {
      const micros = MICRO_KEYS.map((key) => {
        const dv = NUTRIENT_BY_KEY[key]?.dv
        if (!dv) return null
        const pct = Math.round((avgOf(days, key) / dv) * 100)
        return `${NUTRIENT_BY_KEY[key].label} ${pct}%`
      }).filter(Boolean)
      nutrition.push(
        `Micronutrients, average % Daily Value on logged days: ${micros.join(', ')}. IMPORTANT: micro data is only as complete as the source food — branded and hand-entered foods often carry none, so a low number frequently means "not recorded" rather than "not eaten". Do not read these as deficiencies.`,
      )
    }
  } else {
    nutrition.push(
      `No food logged in the last ${NUTRITION_WINDOW_DAYS} days, so intake is unknown.`,
    )
  }

  if (supplementNames.length)
    nutrition.push(
      `Takes these daily supplements (logged outside the diary, so their micros are NOT in the numbers above): ${supplementNames.join(', ')}.`,
    )

  if (nutrition.length) out.push(`Nutrition:\n${nutrition.join('\n')}`)

  return out.join('\n\n')
}
