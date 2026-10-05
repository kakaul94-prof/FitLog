import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import {
  REGION_IDS,
  REGION_LABEL,
  resolveContrib,
  type RegionId,
} from '@/data/bodyMap'

export interface PlannedBar {
  id: RegionId
  label: string
  sets: number
}
export interface PlannedVolume {
  /** Regions with planned sets > 0, most volume first. */
  bars: PlannedBar[]
  /** Raw target sets across the whole cycle (counts even unmapped exercises). */
  totalSets: number
  /** Distinct in-program exercises with no target sets (contribute nothing). */
  needsTarget: number
  /** Distinct in-program exercises not mapped to any muscle region. */
  unmapped: number
}

interface RoutineExRow {
  routine_id: string
  exercise_key: string
  exercise_name: string | null
  target_sets: number | null
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Planned sets per muscle region over one full cycle. `routineIds` is the
 *  program's ordered template ids *with duplicates* (a template appearing twice
 *  in the cycle counts twice); rest days are already excluded. Reuses the same
 *  fractional region resolver as the logged Muscle map, but sums each exercise's
 *  target sets instead of performed sets. */
export function useProgramPlannedVolume(routineIds: string[]) {
  return useQuery({
    queryKey: ['programPlannedVolume', [...routineIds].sort().join(',')],
    enabled: routineIds.length > 0,
    queryFn: async (): Promise<PlannedVolume> => {
      const uniq = [...new Set(routineIds)]
      const { data: rexData, error } = await supabase
        .from('routine_exercises')
        .select('routine_id,exercise_key,exercise_name,target_sets')
        .in('routine_id', uniq)
      if (error) throw error
      const rex = (rexData ?? []) as RoutineExRow[]

      const { data: customs } = await supabase
        .from('custom_exercises')
        .select('id,muscle')
      const customTag = new Map<string, string | null>(
        ((customs ?? []) as { id: string; muscle: string | null }[]).map((c) => [
          `custom:${c.id}`,
          c.muscle,
        ]),
      )

      // Hint counts over distinct exercises (each once, regardless of how many
      // times its routine repeats in the cycle).
      let needsTarget = 0
      let unmapped = 0
      for (const r of rex) {
        const contrib = resolveContrib(r.exercise_key, r.exercise_name, customTag)
        if (!contrib) unmapped++
        else if (r.target_sets == null || r.target_sets <= 0) needsTarget++
      }

      const byRoutine = new Map<string, RoutineExRow[]>()
      for (const r of rex) {
        const list = byRoutine.get(r.routine_id)
        if (list) list.push(r)
        else byRoutine.set(r.routine_id, [r])
      }

      const byRegion = Object.fromEntries(
        REGION_IDS.map((r) => [r, 0]),
      ) as Record<RegionId, number>
      let totalSets = 0
      // Walk the full sequence (with duplicates) so cycle multiplicity counts.
      for (const rid of routineIds) {
        for (const r of byRoutine.get(rid) ?? []) {
          const sets = r.target_sets
          if (!sets || sets <= 0) continue
          totalSets += sets
          const contrib = resolveContrib(r.exercise_key, r.exercise_name, customTag)
          if (!contrib) continue
          for (const [region, w] of Object.entries(contrib)) {
            if (!w) continue
            byRegion[region as RegionId] += sets * w
          }
        }
      }

      const bars = REGION_IDS.map((id) => ({
        id,
        label: REGION_LABEL[id],
        sets: round1(byRegion[id]),
      }))
        .filter((b) => b.sets > 0)
        .sort((a, b) => b.sets - a.sets)

      return { bars, totalSets, needsTarget, unmapped }
    },
  })
}
