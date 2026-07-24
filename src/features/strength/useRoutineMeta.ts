import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { workoutDurationMin, estimateRoutineMinutes } from '@/lib/progression'
import { resolveContrib, REGION_LABEL, type RegionId } from '@/data/bodyMap'

export interface RoutineMeta {
  exerciseCount: number
  /** Personal time estimate: median of recent runs, else ~3 min per target set. */
  estMinutes: number | null
  /** workout_date of the most recent workout started from this routine. */
  lastDone: string | null
  /** Sum of the routine's target sets (0 when none are set). */
  targetSets: number
  /** Top muscle regions the routine hits, biggest contribution first (≤3). */
  topRegions: string[]
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
        .select('exercise_key,exercise_name,target_sets')
        .eq('routine_id', routineId)
      if (re) throw re
      const rows = (rex ?? []) as {
        exercise_key: string
        exercise_name: string | null
        target_sets: number | null
      }[]
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
      const targets = rows.map((r) => r.target_sets)

      const customTag = new Map<string, string | null>()
      if (rows.some((r) => r.exercise_key.startsWith('custom:'))) {
        const { data: customs } = await supabase
          .from('custom_exercises')
          .select('id,muscle')
        for (const c of (customs ?? []) as { id: string; muscle: string | null }[])
          customTag.set(`custom:${c.id}`, c.muscle)
      }
      // Rank regions by target-set contribution (3-set stand-in when unset).
      const byRegion = new Map<RegionId, number>()
      for (const r of rows) {
        const contrib = resolveContrib(r.exercise_key, r.exercise_name, customTag)
        if (!contrib) continue
        const sets = r.target_sets && r.target_sets > 0 ? r.target_sets : 3
        for (const [region, w] of Object.entries(contrib)) {
          if (!w) continue
          const id = region as RegionId
          byRegion.set(id, (byRegion.get(id) ?? 0) + sets * w)
        }
      }
      const topRegions = [...byRegion.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([id]) => REGION_LABEL[id])

      return {
        exerciseCount: rows.length,
        estMinutes: estimateRoutineMinutes(durations, targets),
        lastDone: runs[0]?.workout_date ?? null,
        targetSets: targets.reduce<number>((s, t) => s + (t && t > 0 ? t : 0), 0),
        topRegions,
      }
    },
  })
}
