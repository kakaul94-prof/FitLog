import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { presetExerciseName, type PresetProgram } from '@/data/programs'
import { useProfile, useUpdateProfile } from '@/features/profile/useProfile'
import { useRoutines } from '@/features/strength/useRoutines'
import { todayISO } from '@/lib/date'
import {
  programIsRestorable,
  pruneSequence,
  switchProgramState,
} from '@/lib/program'
import type { ProgramItem } from '@/lib/database.types'

const uid = () => Math.random().toString(36).slice(2)

/** Create one `routines` row (plus its exercises) per training day in a preset
 *  and return the matching rotation. Purely additive: the user's existing
 *  templates are never touched, so switching programs can't lose a routine that
 *  past workouts still point at via `source_routine_id`.
 *
 *  Days are created in order and sequentially — templates are small, and a
 *  serial insert keeps the returned rotation in the preset's order without
 *  needing to sort the results back into place. */
export function useSeedProgramRoutines() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (preset: PresetProgram): Promise<ProgramItem[]> => {
      const items: ProgramItem[] = []
      for (const slot of preset.slots) {
        if (slot === 'rest') {
          items.push({ id: uid(), kind: 'rest' })
          continue
        }
        const { data: r, error: re } = await supabase
          .from('routines')
          .insert({ name: slot.name })
          .select('*')
          .single()
        if (re) throw re
        const routineId = (r as { id: string }).id
        // Lift-only presets, so the cardio target columns are left out entirely
        // (same reason as useSaveRoutine: a DB predating migration_routine_cardio
        // errors on unknown columns even when they're null).
        const rows = slot.exercises.map((e, i) => ({
          routine_id: routineId,
          exercise_key: e.key,
          exercise_name: presetExerciseName(e.key),
          position: i,
          target_sets: e.sets,
          target_reps: e.reps,
          superset_group: e.superset ?? null,
        }))
        const { error: ie } = await supabase
          .from('routine_exercises')
          .insert(rows)
        if (ie) throw ie
        items.push({ id: uid(), kind: 'routine', routineId })
      }
      return items
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routines'] }),
  })
}

/** Make a program active, preferring a rotation the user already has over a
 *  fresh one: a parked snapshot is restored as-is (so a program you've edited
 *  comes back edited), and only a program with nothing to restore gets seeded.
 *  The outgoing rotation is parked by switchProgramState before anything is
 *  overwritten. */
export function useApplyProgram() {
  const { data: profile } = useProfile()
  const { data: routines } = useRoutines()
  const update = useUpdateProfile()
  const seed = useSeedProgramRoutines()

  const apply = async (toId: string, preset: PresetProgram | null) => {
    const state = profile?.program ?? null
    const existing = new Set((routines ?? []).map((r) => r.id))
    const saved = state?.saved?.[toId]
    let sequence: ProgramItem[]
    if (programIsRestorable(saved, existing)) {
      sequence = saved!.sequence
    } else if (preset) {
      sequence = await seed.mutateAsync(preset)
    } else {
      // Custom has no preset to fall back on, so restore what's left of the
      // snapshot — a template deleted while away costs its day, not the rotation.
      const pruned = pruneSequence(saved?.sequence ?? [], existing)
      if (!pruned.some((it) => it.kind === 'routine'))
        throw new Error('No saved rotation to restore')
      sequence = pruned
    }
    await update.mutateAsync({
      program: switchProgramState(state, toId, sequence, todayISO()),
    })
  }

  return { apply, isPending: seed.isPending || update.isPending }
}
