import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { isCardioKey } from '@/lib/cardio'
import type { Routine, RoutineExercise } from '@/lib/database.types'

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
export function useSaveRoutine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      name,
      exercises,
    }: {
      id: string
      name: string
      exercises: Pick<
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
      >[]
    }) => {
      const { error: ue } = await supabase
        .from('routines')
        .update({ name })
        .eq('id', id)
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
        const { error: ie } = await supabase
          .from('routine_exercises')
          .insert(rows)
        if (ie) throw ie
      }
      return { id }
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['routines'] })
      qc.invalidateQueries({ queryKey: ['routine', d.id] })
    },
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
    }: {
      routineId: string
      name: string
      date: string
      plan?: Record<string, number>
    }): Promise<string> => {
      const { data: w, error: we } = await supabase
        .from('workouts')
        .insert({ workout_date: date, name, source_routine_id: routineId })
        .select('*')
        .single()
      if (we) throw we
      const workoutId = (w as { id: string }).id
      const { data: rex } = await supabase
        .from('routine_exercises')
        .select('*')
        .eq('routine_id', routineId)
        .order('position')
      // Cardio items don't become workout exercises — the workout page shows
      // them as a checklist from the source routine; logging one writes a
      // normal exercise_entries row.
      const exs = ((rex ?? []) as RoutineExercise[]).filter(
        (re) => !isCardioKey(re.exercise_key) && (!plan || (plan[re.id] ?? 0) > 0),
      )
      for (const re of exs) {
        const { data: we2 } = await supabase
          .from('workout_exercises')
          .insert({
            workout_id: workoutId,
            exercise_key: re.exercise_key,
            exercise_name: re.exercise_name,
            position: re.position,
            superset_group: re.superset_group,
          })
          .select('*')
          .single()
        const weId = (we2 as { id: string }).id
        // Start every exercise with one empty set — no last-time prefill and no
        // template target numbers loaded, so the boxes begin blank. With a time
        // budget, lay out the planned number of (still blank) sets instead.
        const setCount = plan ? Math.max(1, plan[re.id] ?? 1) : 1
        await supabase.from('workout_sets').insert(
          Array.from({ length: setCount }, (_, i) => ({
            workout_id: workoutId,
            workout_exercise_id: weId,
            exercise_key: re.exercise_key,
            exercise_name: re.exercise_name,
            set_number: i + 1,
            reps: null,
            weight_lb: null,
          })),
        )
      }
      return workoutId
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts'] }),
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
