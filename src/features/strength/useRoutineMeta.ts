import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { workoutDurationMin, estimateRoutineMinutes } from '@/lib/progression'

export interface RoutineMeta {
  exerciseCount: number
  /** Personal time estimate: median of recent runs, else ~3 min per target set. */
  estMinutes: number | null
  /** workout_date of the most recent workout started from this routine. */
  lastDone: string | null
}

/** Hero-line meta for a template: exercise count, a "usually takes you" time
 *  estimate, and when it was last done. Keyed under ['workouts', …] so every
 *  existing workout mutation's invalidation refreshes it too. */
export function useRoutineMeta(routineId: string | undefined) {
  return useQuery({
    queryKey: ['workouts', 'routineMeta', routineId],
    enabled: !!routineId,
    queryFn: async (): Promise<RoutineMeta> => {
      const { data: rex, error: re } = await supabase
        .from('routine_exercises')
        .select('target_sets')
        .eq('routine_id', routineId)
      if (re) throw re
      const { data: ws, error: we } = await supabase
        .from('workouts')
        .select('created_at, workout_date, workout_sets(created_at)')
        .eq('source_routine_id', routineId)
        .order('workout_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(5)
      if (we) throw we
      const runs = (ws ?? []) as {
        created_at: string
        workout_date: string
        workout_sets: { created_at: string }[]
      }[]
      const durations = runs.map((w) =>
        workoutDurationMin(
          w.created_at,
          w.workout_sets.map((s) => s.created_at),
        ),
      )
      const targets = ((rex ?? []) as { target_sets: number | null }[]).map(
        (r) => r.target_sets,
      )
      return {
        exerciseCount: (rex ?? []).length,
        estMinutes: estimateRoutineMinutes(durations, targets),
        lastDone: runs[0]?.workout_date ?? null,
      }
    },
  })
}
