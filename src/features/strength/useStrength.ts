import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Workout, WorkoutExercise, WorkoutSet } from '@/lib/database.types'

export function useWorkouts() {
  return useQuery({
    queryKey: ['workouts'],
    queryFn: async (): Promise<Workout[]> => {
      const { data, error } = await supabase
        .from('workouts')
        .select('*')
        .order('workout_date', { ascending: false })
        .limit(50)
      if (error) throw error
      return (data ?? []) as Workout[]
    },
  })
}

export interface WorkoutDetail {
  workout: Workout | null
  exercises: WorkoutExercise[]
  sets: WorkoutSet[]
}

export function useWorkout(id: string | undefined) {
  return useQuery({
    queryKey: ['workout', id],
    enabled: !!id,
    queryFn: async (): Promise<WorkoutDetail> => {
      const { data: w, error: we } = await supabase
        .from('workouts')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (we) throw we
      const { data: exs, error: ee } = await supabase
        .from('workout_exercises')
        .select('*')
        .eq('workout_id', id)
        .order('position')
      if (ee) throw ee
      const { data: sets, error: se } = await supabase
        .from('workout_sets')
        .select('*')
        .eq('workout_id', id)
        .order('set_number')
      if (se) throw se
      return {
        workout: (w as Workout | null) ?? null,
        exercises: (exs ?? []) as WorkoutExercise[],
        sets: (sets ?? []) as WorkoutSet[],
      }
    },
  })
}

export function useCreateWorkout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (w: {
      workout_date: string
      name: string | null
      source_routine_id?: string | null
    }): Promise<Workout> => {
      const { data, error } = await supabase
        .from('workouts')
        .insert(w)
        .select('*')
        .single()
      if (error) throw error
      return data as Workout
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts'] }),
  })
}

export function useDeleteWorkout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('workouts').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts'] }),
  })
}

/** Patch workout fields (e.g. rest_seconds); updates cache in place — no refetch. */
export function useUpdateWorkout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: { id: string } & Partial<Workout>) => {
      const { error } = await supabase.from('workouts').update(patch).eq('id', id)
      if (error) throw error
      return { id, patch }
    },
    onSuccess: ({ id, patch }) => {
      qc.setQueryData(['workout', id], (prev: WorkoutDetail | undefined) =>
        prev?.workout
          ? { ...prev, workout: { ...prev.workout, ...patch } }
          : prev,
      )
    },
  })
}

/** Add an exercise to a workout: pre-fills sets from last time; optionally supersets with another. */
export function useAddExercise() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      workoutId,
      key,
      name,
      supersetWithId,
    }: {
      workoutId: string
      key: string
      name: string
      supersetWithId?: string
    }) => {
      const { data: existing } = await supabase
        .from('workout_exercises')
        .select('id,position,superset_group')
        .eq('workout_id', workoutId)
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
              .from('workout_exercises')
              .update({ superset_group: group })
              .eq('id', anchor.id)
          }
        }
      }

      const { data: we, error: weErr } = await supabase
        .from('workout_exercises')
        .insert({
          workout_id: workoutId,
          exercise_key: key,
          exercise_name: name,
          position,
          superset_group: group,
        })
        .select('*')
        .single()
      if (weErr) throw weErr

      const { data: prev } = await supabase
        .from('workout_sets')
        .select('*')
        .eq('exercise_key', key)
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
          workout_exercise_id: (we as WorkoutExercise).id,
          exercise_key: key,
          exercise_name: name,
          set_number: s.set_number,
          reps: s.reps,
          weight_lb: s.weight_lb,
        }))
      } else {
        rows = [
          {
            workout_id: workoutId,
            workout_exercise_id: (we as WorkoutExercise).id,
            exercise_key: key,
            exercise_name: name,
            set_number: 1,
            reps: null,
            weight_lb: null,
          },
        ]
      }
      const { error: sErr } = await supabase.from('workout_sets').insert(rows)
      if (sErr) throw sErr
      return { workoutId }
    },
    onSuccess: (d) => qc.invalidateQueries({ queryKey: ['workout', d.workoutId] }),
  })
}

export function useUpdateExercise() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      workoutId,
      ...patch
    }: { id: string; workoutId: string } & Partial<WorkoutExercise>) => {
      const { error } = await supabase
        .from('workout_exercises')
        .update(patch)
        .eq('id', id)
      if (error) throw error
      return { workoutId }
    },
    onSuccess: (d) => qc.invalidateQueries({ queryKey: ['workout', d.workoutId] }),
  })
}

export function useDeleteExercise() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, workoutId }: { id: string; workoutId: string }) => {
      const { error } = await supabase
        .from('workout_exercises')
        .delete()
        .eq('id', id)
      if (error) throw error
      return { workoutId }
    },
    onSuccess: (d) => qc.invalidateQueries({ queryKey: ['workout', d.workoutId] }),
  })
}

export function useAddSet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (s: {
      workout_id: string
      workout_exercise_id: string
      exercise_key: string
      exercise_name: string
      set_number: number
      reps: number | null
      weight_lb: number | null
    }) => {
      const { error } = await supabase.from('workout_sets').insert(s)
      if (error) throw error
      return { workout_id: s.workout_id }
    },
    onSuccess: (d) => qc.invalidateQueries({ queryKey: ['workout', d.workout_id] }),
  })
}

export function useUpdateSet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      workout_id,
      ...patch
    }: { id: string; workout_id: string } & Partial<WorkoutSet>) => {
      const { error } = await supabase
        .from('workout_sets')
        .update(patch)
        .eq('id', id)
      if (error) throw error
      return { workout_id }
    },
    onSuccess: (d) => qc.invalidateQueries({ queryKey: ['workout', d.workout_id] }),
  })
}

export function useDeleteSet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, workout_id }: { id: string; workout_id: string }) => {
      const { error } = await supabase.from('workout_sets').delete().eq('id', id)
      if (error) throw error
      return { workout_id }
    },
    onSuccess: (d) => qc.invalidateQueries({ queryKey: ['workout', d.workout_id] }),
  })
}

export function useLastExerciseNote(key: string, excludeWorkoutId: string) {
  return useQuery({
    queryKey: ['lastNote', key, excludeWorkoutId],
    queryFn: async (): Promise<string | null> => {
      const { data } = await supabase
        .from('workout_exercises')
        .select('notes,created_at,workout_id')
        .eq('exercise_key', key)
        .neq('workout_id', excludeWorkoutId)
        .not('notes', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
      return (data?.[0]?.notes as string | undefined) ?? null
    },
  })
}

export interface ExerciseSessionStat {
  date: string
  max: number
  total: number
  avg: number
}

/** Per-session stats for one exercise: max weight, total volume, average weight. */
export function useExerciseHistory(key: string | undefined) {
  return useQuery({
    queryKey: ['exerciseHistory', key],
    enabled: !!key,
    queryFn: async (): Promise<ExerciseSessionStat[]> => {
      const { data: sets, error } = await supabase
        .from('workout_sets')
        .select('workout_id,reps,weight_lb')
        .eq('exercise_key', key)
      if (error) throw error
      const s = (sets ?? []) as {
        workout_id: string
        reps: number | null
        weight_lb: number | null
      }[]
      if (!s.length) return []
      const ids = [...new Set(s.map((x) => x.workout_id))]
      const { data: ws } = await supabase
        .from('workouts')
        .select('id,workout_date')
        .in('id', ids)
      const dateById = new Map(
        ((ws ?? []) as { id: string; workout_date: string }[]).map((w) => [
          w.id,
          w.workout_date,
        ]),
      )
      const byW = new Map<string, typeof s>()
      for (const x of s) {
        const arr = byW.get(x.workout_id) ?? []
        arr.push(x)
        byW.set(x.workout_id, arr)
      }
      const rows: ExerciseSessionStat[] = []
      for (const [wid, arr] of byW) {
        const date = dateById.get(wid)
        if (!date) continue
        const weights = arr.map((a) => a.weight_lb ?? 0).filter((w) => w > 0)
        const max = weights.length ? Math.max(...weights) : 0
        const total = arr.reduce(
          (sum, a) => sum + (a.reps ?? 0) * (a.weight_lb ?? 0),
          0,
        )
        const avg = weights.length
          ? Math.round(weights.reduce((x, y) => x + y, 0) / weights.length)
          : 0
        rows.push({ date, max, total, avg })
      }
      return rows.sort((a, b) => a.date.localeCompare(b.date))
    },
  })
}
