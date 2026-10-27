import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { addDaysISO, todayISO } from '@/lib/date'
import { jointsLoaded, musclesWorked, withRecovery, type Lift } from '@/lib/recovery'
import type { RegionId } from '@/data/bodyMap'
import type { RecoveryAnswer, Workout } from '@/lib/database.types'

export interface RecoveryTarget {
  workout: Workout
  lifts: Lift[]
  muscles: RegionId[]
  joints: string[]
  customTag: Map<string, string | null>
}

type Row = Workout & {
  workout_exercises: { exercise_key: string; exercise_name: string; position: number }[]
  workout_sets: { reps: number | null; weight_lb: number | null }[]
}

/** The workout to ask "how did it land?" about: the one the next-day notification
 *  named (`id`), or else the latest one in the last 3 days with a logged set.
 *  null when there's none — the check-in then skips the recovery section. */
export function useRecoveryTarget(id?: string | null, enabled = true) {
  return useQuery({
    queryKey: ['recoveryTarget', id ?? 'last'],
    enabled,
    staleTime: 0,
    queryFn: async (): Promise<RecoveryTarget | null> => {
      let q = supabase
        .from('workouts')
        .select(
          '*, workout_exercises(exercise_key,exercise_name,position), workout_sets(reps,weight_lb)',
        )
      q = id
        ? q.eq('id', id)
        : q
            .gte('workout_date', addDaysISO(todayISO(), -2))
            .order('workout_date', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(5)
      const { data, error } = await q
      if (error) return null // never block a start on this
      const w = ((data ?? []) as Row[]).find((r) =>
        r.workout_sets.some((s) => s.reps != null || s.weight_lb != null),
      )
      if (!w) return null
      const { data: customs } = await supabase.from('custom_exercises').select('id,muscle')
      const customTag = new Map<string, string | null>(
        ((customs ?? []) as { id: string; muscle: string | null }[]).map((c) => [
          `custom:${c.id}`,
          c.muscle,
        ]),
      )
      const lifts = [...w.workout_exercises]
        .sort((a, b) => a.position - b.position)
        .map((e) => ({ key: e.exercise_key, name: e.exercise_name }))
      const { workout_exercises: _e, workout_sets: _s, ...workout } = w // eslint-disable-line @typescript-eslint/no-unused-vars
      return {
        workout,
        lifts,
        muscles: musclesWorked(lifts, customTag),
        joints: jointsLoaded(lifts),
        customTag,
      }
    },
  })
}

/** Store a recovery answer on that workout's checkin. Best-effort: before
 *  migration_workout_checkin.sql the column is missing and this is a no-op. */
export function useSaveRecovery() {
  const qc = useQueryClient()
  return async (workout: Workout, slot: 'morning' | 'pre', answer: RecoveryAnswer) => {
    await supabase
      .from('workouts')
      .update({ checkin: withRecovery(workout.checkin, slot, answer) })
      .eq('id', workout.id)
    qc.invalidateQueries({ queryKey: ['recoveryTarget'] })
    qc.invalidateQueries({ queryKey: ['workout', workout.id] })
  }
}
