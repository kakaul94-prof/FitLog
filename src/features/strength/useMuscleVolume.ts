import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import {
  REGION_IDS,
  REGION_LABEL,
  resolveContrib,
  type RegionId,
} from '@/data/bodyMap'

export interface MuscleBar {
  id: RegionId
  label: string
  sets: number
}
export interface UnmappedExercise {
  name: string
  sets: number
}
/** One exercise's weighted set contribution to a single muscle region. */
export interface MuscleExercise {
  name: string
  sets: number
}
export interface MuscleVolume {
  byRegion: Record<RegionId, number>
  bars: MuscleBar[]
  /** Per region: the exercises that built its volume, weighted sets, desc. */
  byRegionExercises: Record<RegionId, MuscleExercise[]>
  totalSets: number
  unmapped: number
  unmappedList: UnmappedExercise[]
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
      const regionExercises = Object.fromEntries(
        REGION_IDS.map((r) => [r, new Map<string, number>()]),
      ) as Record<RegionId, Map<string, number>>
      let totalSets = 0
      let unmapped = 0
      const unmappedCounts = new Map<string, number>()

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
          const contrib = resolveContrib(
            s.exercise_key,
            s.exercise_name,
            customTag,
          )
          if (!contrib) {
            unmapped++
            const name = s.exercise_name?.trim() || s.exercise_key
            unmappedCounts.set(name, (unmappedCounts.get(name) ?? 0) + 1)
            continue
          }
          const exName = s.exercise_name?.trim() || s.exercise_key
          for (const [region, w] of Object.entries(contrib)) {
            if (!w) continue
            byRegion[region as RegionId] += w
            const m = regionExercises[region as RegionId]
            m.set(exName, (m.get(exName) ?? 0) + w)
          }
        }
      }

      for (const r of REGION_IDS) byRegion[r] = round1(byRegion[r])
      const bars = REGION_IDS.map((id) => ({
        id,
        label: REGION_LABEL[id],
        sets: byRegion[id],
      })).sort((a, b) => b.sets - a.sets)

      const byRegionExercises = Object.fromEntries(
        REGION_IDS.map((id) => [
          id,
          [...regionExercises[id].entries()]
            .map(([name, sets]) => ({ name, sets: round1(sets) }))
            .sort((a, b) => b.sets - a.sets),
        ]),
      ) as Record<RegionId, MuscleExercise[]>

      const unmappedList = [...unmappedCounts.entries()]
        .map(([name, sets]) => ({ name, sets }))
        .sort((a, b) => b.sets - a.sets)

      return { byRegion, bars, byRegionExercises, totalSets, unmapped, unmappedList }
    },
  })
}
