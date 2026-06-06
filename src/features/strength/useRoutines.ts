import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Routine, RoutineExercise, WorkoutSet } from '@/lib/database.types'

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

export function useUpdateRoutine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase
        .from('routines')
        .update({ name })
        .eq('id', id)
      if (error) throw error
      return { id }
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['routines'] })
      qc.invalidateQueries({ queryKey: ['routine', d.id] })
    },
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

export function useAddRoutineExercise() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      routineId,
      key,
      name,
      supersetWithId,
    }: {
      routineId: string
      key: string
      name: string
      supersetWithId?: string
    }) => {
      const { data: existing } = await supabase
        .from('routine_exercises')
        .select('id,position,superset_group')
        .eq('routine_id', routineId)
      const ex = (existing ?? []) as {
        id: string
        position: number
        superset_group: number | null
      }[]
      const position = ex.length
      let group: number | null = null
      if (supersetWithId) {
        const anchor = ex.find((e) => e.id === supersetWithId)
        group = anchor?.superset_group ?? null
        if (group == null) {
          group = ex.reduce((m, e) => Math.max(m, e.superset_group ?? 0), 0) + 1
          if (anchor) {
            await supabase
              .from('routine_exercises')
              .update({ superset_group: group })
              .eq('id', anchor.id)
          }
        }
      }
      const { error } = await supabase.from('routine_exercises').insert({
        routine_id: routineId,
        exercise_key: key,
        exercise_name: name,
        position,
        superset_group: group,
      })
      if (error) throw error
      return { routineId }
    },
    onSuccess: (d) => qc.invalidateQueries({ queryKey: ['routine', d.routineId] }),
  })
}

export function useUpdateRoutineExercise() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      routineId,
      ...patch
    }: { id: string; routineId: string } & Partial<RoutineExercise>) => {
      const { error } = await supabase
        .from('routine_exercises')
        .update(patch)
        .eq('id', id)
      if (error) throw error
      return { routineId }
    },
    onSuccess: (d) => qc.invalidateQueries({ queryKey: ['routine', d.routineId] }),
  })
}

export function useRemoveRoutineExercise() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, routineId }: { id: string; routineId: string }) => {
      const { error } = await supabase
        .from('routine_exercises')
        .delete()
        .eq('id', id)
      if (error) throw error
      return { routineId }
    },
    onSuccess: (d) => qc.invalidateQueries({ queryKey: ['routine', d.routineId] }),
  })
}

/** Create a workout from a routine: copies exercises (+ supersets), pre-filling
 *  sets from last performance, falling back to the template's target sets/reps. */
export function useStartFromRoutine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      routineId,
      name,
      date,
    }: {
      routineId: string
      name: string
      date: string
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
      const exs = (rex ?? []) as RoutineExercise[]
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
        const { data: prev } = await supabase
          .from('workout_sets')
          .select('*')
          .eq('exercise_key', re.exercise_key)
          .order('created_at', { ascending: false })
          .limit(30)
        const prior = ((prev ?? []) as WorkoutSet[]).filter(
          (s) => s.workout_id !== workoutId,
        )
        let rows
        if (prior.length) {
          const wid = prior[0].workout_id
          const tmpl = prior
            .filter((s) => s.workout_id === wid)
            .sort((a, b) => a.set_number - b.set_number)
          rows = tmpl.map((s) => ({
            workout_id: workoutId,
            workout_exercise_id: weId,
            exercise_key: re.exercise_key,
            exercise_name: re.exercise_name,
            set_number: s.set_number,
            reps: s.reps,
            weight_lb: s.weight_lb,
          }))
        } else {
          const n = re.target_sets ?? 1
          rows = Array.from({ length: n }, (_, i) => ({
            workout_id: workoutId,
            workout_exercise_id: weId,
            exercise_key: re.exercise_key,
            exercise_name: re.exercise_name,
            set_number: i + 1,
            reps: re.target_reps ?? null,
            weight_lb: null,
          }))
        }
        await supabase.from('workout_sets').insert(rows)
      }
      return workoutId
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts'] }),
  })
}
