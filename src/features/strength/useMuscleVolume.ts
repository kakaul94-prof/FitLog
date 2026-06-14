import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import {
  BUILTIN_TAG,
  EXERCISE_OVERRIDE,
  NAME_CONTRIB,
  REGION_IDS,
  REGION_LABEL,
  contribForTag,
  type RegionId,
} from '@/data/bodyMap'
import { normalizeExerciseName } from '@/data/exerciseAliases'

export interface MuscleBar {
  id: RegionId
  label: string
  sets: number
}
export interface MuscleVolume {
  byRegion: Record<RegionId, number>
  bars: MuscleBar[]
  totalSets: number
  unmapped: number
}

function zeroRegions(): Record<RegionId, number> {
  return Object.fromEntries(REGION_IDS.map((r) => [r, 0])) as Record<RegionId, number>
}
const round1 = (n: number) => Math.round(n * 10) / 10

/** Weekly fractional sets per muscle region over [start, end] (inclusive ISO dates). */
export function useMuscleVolume(start: string, end: string) {
  return useQuery({
    queryKey: ['muscleVolume', start, end],
    queryFn: async (): Promise<MuscleVolume> => {
      const { data: ws, error: we } = await supabase
        .from('workouts')
        .select('id')
        .gte('workout_date', start)
        .lte('workout_date', end)
      if (we) throw we
      const ids = ((ws ?? []) as { id: string }[]).map((w) => w.id)

      const byRegion = zeroRegions()
      let totalSets = 0
      let unmapped = 0

      if (ids.length) {
        const { data: setsData, error: se } = await supabase
          .from('workout_sets')
          .select('exercise_key,exercise_name,reps,weight_lb')
          .in('workout_id', ids)
        if (se) throw se
        const sets = (setsData ?? []) as {
          exercise_key: string
          exercise_name: string | null
          reps: number | null
          weight_lb: number | null
        }[]

        const { data: customs } = await supabase
          .from('custom_exercises')
          .select('id,muscle')
        const customTag = new Map<string, string | null>(
          ((customs ?? []) as { id: string; muscle: string | null }[]).map((c) => [
            `custom:${c.id}`,
            c.muscle,
          ]),
        )

        for (const s of sets) {
          // Performed set = reps or weight present; skips the blank prefill rows
          // that adding an exercise inserts.
          if (s.reps == null && s.weight_lb == null) continue
          totalSets++
          const tag = s.exercise_key.startsWith('custom:')
            ? customTag.get(s.exercise_key) ?? null
            : BUILTIN_TAG[s.exercise_key] ?? null
          const nameContrib = s.exercise_name
            ? NAME_CONTRIB[normalizeExerciseName(s.exercise_name)]
            : undefined
          const contrib =
            EXERCISE_OVERRIDE[s.exercise_key] ?? nameContrib ?? contribForTag(tag)
          if (!contrib) {
            unmapped++
            continue
          }
          for (const [region, w] of Object.entries(contrib)) {
            if (w) byRegion[region as RegionId] += w
          }
        }
      }

      for (const r of REGION_IDS) byRegion[r] = round1(byRegion[r])
      const bars = REGION_IDS.map((id) => ({
        id,
        label: REGION_LABEL[id],
        sets: byRegion[id],
      })).sort((a, b) => b.sets - a.sets)

      return { byRegion, bars, totalSets, unmapped }
    },
  })
}
