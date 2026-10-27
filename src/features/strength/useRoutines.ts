import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { isCardioKey } from '@/lib/cardio'
import { isLiftKey } from '@/lib/warmup'
import { mergeTemplateRows, type TemplateRow } from '@/lib/templateDiff'
import type { WorkoutDetail } from './useStrength'
import type {
  IntervalsTarget,
  Routine,
  RoutineExercise,
  Workout,
  WorkoutCheckin,
  WorkoutExercise,
  WorkoutSet,
} from '@/lib/database.types'

export function useRoutines() {
  return useQuery({
    queryKey: ['routines'],
    queryFn: async (): Promise<Routine[]> => {
      const { data, error } = await supabase
        .from('routines')
        .select('*')
        .order('created_at')
      if (error) throw error
      return (data ?? []) as Routine[]
    },
  })
}

export function useRoutine(id: string | undefined) {
  return useQuery({
    queryKey: ['routine', id],
    enabled: !!id,
    queryFn: async () => {
      const { data: r, error: re } = await supabase
        .from('routines')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (re) throw re
      const { data: ex, error: ee } = await supabase
        .from('routine_exercises')
        .select('*')
        .eq('routine_id', id)
        .order('position')
      if (ee) throw ee
      return {
        routine: (r as Routine | null) ?? null,
        exercises: (ex ?? []) as RoutineExercise[],
      }
    },
  })
}

export function useCreateRoutine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string): Promise<Routine> => {
      const { data, error } = await supabase
        .from('routines')
        .insert({ name })
        .select('*')
        .single()
      if (error) throw error
      return data as Routine
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routines'] }),
  })
}

export function useDeleteRoutine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('routines').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routines'] }),
  })
}

/** Persist a template in one shot: update the name and replace its whole
 *  exercise list (delete-all + re-insert in order). The editor stages edits in
 *  local state so the user can Save (this) or Discard — nothing is written on
 *  blur. Templates are tiny, so a replace is simpler/safer than diffing. */
export type RoutineRowInput = Pick<
  RoutineExercise,
  | 'exercise_key'
  | 'exercise_name'
  | 'target_sets'
  | 'target_reps'
  | 'superset_group'
  | 'target_duration_min'
  | 'target_distance_mi'
  | 'target_zone'
  | 'intervals'
  | 'is_optional'
>

/** The write behind the editor's Save and the workout page's "Update
 *  template": rename, set the rest timer, replace every exercise row in order. */
export async function saveRoutineRows({
  id,
  name,
  exercises,
  rest_seconds,
}: {
  id: string
  name: string
  exercises: RoutineRowInput[]
  rest_seconds?: number
}) {
  // The rest column arrives with migration_routine_rest.sql — on a DB that
  // predates it, retry the rename alone rather than block the save.
  let { error: ue } = await supabase
    .from('routines')
    .update(rest_seconds != null ? { name, rest_seconds } : { name })
    .eq('id', id)
  if (ue && rest_seconds != null)
    ({ error: ue } = await supabase.from('routines').update({ name }).eq('id', id))
  if (ue) throw ue
  const { error: de } = await supabase
    .from('routine_exercises')
    .delete()
    .eq('routine_id', id)
  if (de) throw de
  if (exercises.length) {
    // Cardio columns are only sent when the template actually has a cardio
    // item, so lift-only templates keep saving on a DB that predates
    // migration_routine_cardio.sql (unknown columns error even when null).
    const hasCardio = exercises.some((e) => isCardioKey(e.exercise_key))
    // Same guard for the time-budget column: only sent once something is
    // actually flagged, so templates still save on a DB that predates
    // migration_routine_time_budget.sql.
    const hasOptional = exercises.some((e) => e.is_optional)
    const rows = exercises.map((e, i) => ({
      routine_id: id,
      exercise_key: e.exercise_key,
      exercise_name: e.exercise_name,
      position: i,
      target_sets: e.target_sets,
      target_reps: e.target_reps,
      superset_group: e.superset_group,
      ...(hasOptional ? { is_optional: !!e.is_optional } : {}),
      ...(hasCardio
        ? {
            target_duration_min: e.target_duration_min ?? null,
            target_distance_mi: e.target_distance_mi ?? null,
            target_zone: e.target_zone ?? null,
            intervals: e.intervals ?? null,
          }
        : {}),
    }))
    const { error: ie } = await supabase.from('routine_exercises').insert(rows)
    if (ie) throw ie
  }
  return { id }
}

export function useSaveRoutine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveRoutineRows,
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['routines'] })
      qc.invalidateQueries({ queryKey: ['routine', d.id] })
    },
  })
}

// Template rows built from a workout carry only the lift fields; fill the
// cardio columns so the shared save can send a complete row.
const toRowInput = (r: TemplateRow): RoutineRowInput => ({
  exercise_key: r.exercise_key,
  exercise_name: r.exercise_name,
  target_sets: r.target_sets,
  target_reps: r.target_reps,
  superset_group: r.superset_group,
  is_optional: r.is_optional ?? false,
  target_duration_min: r.target_duration_min ?? null,
  target_distance_mi: r.target_distance_mi ?? null,
  target_zone: r.target_zone ?? null,
  intervals: (r.intervals ?? null) as IntervalsTarget | null,
})

/** "Update <template>" on the workout Done sheet: the workout's lifts replace
 *  the template's lift rows (its warm-up and cardio rows stay put) and the
 *  workout's rest timer becomes the template's. */
export function useUpdateRoutineFromWorkout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      routineId,
      name,
      lifts,
      rest_seconds,
    }: {
      routineId: string
      name: string
      lifts: TemplateRow[]
      rest_seconds: number
    }) => {
      const { data: rex, error } = await supabase
        .from('routine_exercises')
        .select('*')
        .eq('routine_id', routineId)
        .order('position')
      if (error) throw error
      const rows = mergeTemplateRows((rex ?? []) as RoutineExercise[], lifts)
      await saveRoutineRows({
        id: routineId,
        name,
        exercises: rows.map(toRowInput),
        rest_seconds,
      })
      return { id: routineId }
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['routines'] })
      qc.invalidateQueries({ queryKey: ['routine', d.id] })
    },
  })
}

/** "Save as new template" from a workout: a fresh routine holding the
 *  workout's lifts and rest timer. Resolves to the new routine. */
export function useCreateRoutineFromWorkout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      name,
      lifts,
      rest_seconds,
    }: {
      name: string
      lifts: TemplateRow[]
      rest_seconds: number
    }): Promise<Routine> => {
      const { data, error } = await supabase
        .from('routines')
        .insert({ name })
        .select('*')
        .single()
      if (error) throw error
      const r = data as Routine
      await saveRoutineRows({
        id: r.id,
        name,
        exercises: lifts.map(toRowInput),
        rest_seconds,
      })
      return r
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routines'] }),
  })
}

/** Create a workout from a routine: copies exercises (+ supersets) and starts
 *  each with a single blank set — no prefill from last time or template targets.
 *
 *  `plan` is the time-budget trim (routine_exercise id → sets to keep). Pass it
 *  and the session is laid out to fit: exercises at 0 sets are left behind, and
 *  the rest start with that many blank sets so the trimmed plan is in front of
 *  you instead of in your head. Without it, nothing changes — one blank set
 *  each, every exercise. */
export function useStartFromRoutine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      routineId,
      name,
      date,
      plan,
      swaps,
      skip,
      checkin,
    }: {
      routineId: string
      name: string
      date: string
      plan?: Record<string, number>
      /** Pre-workout check-in: routine_exercise id → the lift to do instead. */
      swaps?: Record<string, { key: string; name: string }>
      /** Pre-workout check-in: routine_exercise ids to leave out today. */
      skip?: string[]
      checkin?: WorkoutCheckin | null
    }): Promise<string> => {
      const row: Record<string, unknown> = {
        workout_date: date,
        name,
        source_routine_id: routineId,
      }
      // Seed the rest timer from the template (migration_routine_rest.sql).
      // A DB without the column errors here → the workout keeps its default.
      // The template's exercises are read at the same time.
      const [{ data: rt }, { data: rex }] = await Promise.all([
        supabase
          .from('routines')
          .select('rest_seconds')
          .eq('id', routineId)
          .maybeSingle(),
        supabase
          .from('routine_exercises')
          .select('*')
          .eq('routine_id', routineId)
          .order('position'),
      ])
      const tplRest = (rt as { rest_seconds?: number } | null)?.rest_seconds
      if (typeof tplRest === 'number') row.rest_seconds = tplRest
      let { data: w, error: we } = await supabase
        .from('workouts')
        .insert(checkin ? { ...row, checkin } : { ...row })
        .select('*')
        .single()
      // Before migration_workout_checkin.sql the column doesn't exist — the
      // swaps still apply, only the record of them is lost. Never block a start.
      if (we && checkin) {
        ;({ data: w, error: we } = await supabase
          .from('workouts')
          .insert(row)
          .select('*')
          .single())
      }
      if (we) throw we
      const workout = w as Workout
      const workoutId = workout.id
      // Cardio items don't become workout exercises — the workout page shows
      // them as a checklist from the source routine; logging one writes a
      // normal exercise_entries row.
      const exs = ((rex ?? []) as RoutineExercise[]).filter(
        (re) =>
          isLiftKey(re.exercise_key) &&
          (!plan || (plan[re.id] ?? 0) > 0) &&
          !skip?.includes(re.id),
      )
      // All exercises go in one insert and all their sets in a second, instead
      // of two requests per exercise. Ids are chosen here so each set can name
      // its exercise without waiting for the first insert's reply.
      const exRows = exs.map((orig) => {
        const sw = swaps?.[orig.id]
        return {
          id: crypto.randomUUID(),
          workout_id: workoutId,
          exercise_key: sw ? sw.key : orig.exercise_key,
          exercise_name: sw ? sw.name : orig.exercise_name,
          position: orig.position,
          superset_group: orig.superset_group,
        }
      })
      // Start every exercise with one empty set — no last-time prefill and no
      // template target numbers loaded, so the boxes begin blank. With a time
      // budget, lay out the planned number of (still blank) sets instead.
      const setRows = exRows.flatMap((we2, i) => {
        const setCount = plan ? Math.max(1, plan[exs[i].id] ?? 1) : 1
        return Array.from({ length: setCount }, (_, n) => ({
          workout_id: workoutId,
          workout_exercise_id: we2.id,
          exercise_key: we2.exercise_key,
          exercise_name: we2.exercise_name,
          set_number: n + 1,
          reps: null,
          weight_lb: null,
        }))
      })
      let exercises: WorkoutExercise[] = []
      let sets: WorkoutSet[] = []
      if (exRows.length) {
        const { data: exIns, error: exErr } = await supabase
          .from('workout_exercises')
          .insert(exRows)
          .select('*')
        if (exErr) throw exErr
        const { data: setIns, error: setErr } = await supabase
          .from('workout_sets')
          .insert(setRows)
          .select('*')
        if (setErr) throw setErr
        exercises = ((exIns ?? []) as WorkoutExercise[]).sort(
          (a, b) => a.position - b.position,
        )
        sets = ((setIns ?? []) as WorkoutSet[]).sort(
          (a, b) => a.set_number - b.set_number,
        )
      }
      // The workout page opens on these rows with no fetch of its own.
      const detail: WorkoutDetail = { workout, exercises, sets }
      qc.setQueryData(['workout', workoutId], detail)
      return workoutId
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workouts'] })
    },
  })
}

/** Flip one template exercise between core and droppable (the time-budget
 *  flag). Lives on the template, so it sticks for every future session. */
export function useSetExerciseOptional() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      isOptional,
    }: {
      routineId: string
      id: string
      isOptional: boolean
    }) => {
      const { error } = await supabase
        .from('routine_exercises')
        .update({ is_optional: isOptional })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['routine', v.routineId] })
      qc.invalidateQueries({ queryKey: ['routines'] })
    },
  })
}
