import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type {
  Workout,
  WorkoutExercise,
  WorkoutSet,
  StrengthGoal,
} from '@/lib/database.types'
import { suggestNext, currentE1RM } from '@/lib/progression'

export function useWorkouts() {
  return useQuery({
    queryKey: ['workouts'],
    queryFn: async (): Promise<Workout[]> => {
      const { data, error } = await supabase
        .from('workouts')
        .select('*')
        // created_at tie-break: same-date workouts otherwise sort arbitrarily,
        // which can flip the program's "last done" between fetches.
        .order('workout_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return (data ?? []) as Workout[]
    },
  })
}

/** Workouts within an inclusive date range (newest first) — for the calendar. */
export function useWorkoutsRange(start: string, end: string) {
  return useQuery({
    queryKey: ['workouts', 'range', start, end],
    queryFn: async (): Promise<Workout[]> => {
      const { data, error } = await supabase
        .from('workouts')
        .select('*')
        .gte('workout_date', start)
        .lte('workout_date', end)
        .order('workout_date', { ascending: false })
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
      // Keep the recent-workouts list + calendar in sync (e.g. rename / re-date).
      qc.invalidateQueries({ queryKey: ['workouts'] })
    },
  })
}

/** Full snapshot of a workout's editable content, captured when the WorkoutPage
 * opens so "Discard changes" can revert this session's edits. */
export interface WorkoutSnapshot {
  exercises: WorkoutExercise[]
  sets: WorkoutSet[]
  rest_seconds: number
}

/**
 * Revert a workout to a snapshot taken when the page opened — the "Discard
 * changes" path. A minimal diff, so it never mass-deletes: rows added this
 * session are removed, rows deleted this session are re-inserted, and changed
 * rows are restored to their snapshot values. The workout itself is never
 * deleted here (that's long-press on the list). Exercises deleted this session
 * come back with fresh ids, so their sets are re-created under the new id.
 */
export function useRestoreWorkout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      workoutId,
      snapshot,
      current,
    }: {
      workoutId: string
      snapshot: WorkoutSnapshot
      current: { exercises: WorkoutExercise[]; sets: WorkoutSet[] }
    }) => {
      const exRow = (e: WorkoutExercise) => ({
        workout_id: workoutId,
        exercise_key: e.exercise_key,
        exercise_name: e.exercise_name,
        position: e.position,
        notes: e.notes,
        superset_group: e.superset_group,
        started_at: e.started_at,
        ended_at: e.ended_at,
      })
      const setRow = (s: WorkoutSet, weId: string | null) => ({
        workout_id: workoutId,
        workout_exercise_id: weId,
        exercise_key: s.exercise_key,
        exercise_name: s.exercise_name,
        set_number: s.set_number,
        reps: s.reps,
        weight_lb: s.weight_lb,
        duration_sec: s.duration_sec,
        distance: s.distance,
        effort: s.effort,
        is_warmup: s.is_warmup,
        feel: s.feel ?? null,
        pain: s.pain ?? null,
      })

      const snapExIds = new Set(snapshot.exercises.map((e) => e.id))
      const curById = new Map<string, WorkoutExercise>(
        current.exercises.map((e) => [e.id, e] as const),
      )

      // 1. Exercises added this session → delete (cascade removes their sets).
      const addedEx = current.exercises.filter((e) => !snapExIds.has(e.id))
      if (addedEx.length) {
        const { error } = await supabase
          .from('workout_exercises')
          .delete()
          .in('id', addedEx.map((e) => e.id))
        if (error) throw error
      }

      // 2. Surviving exercises whose fields changed → restore them.
      for (const e of snapshot.exercises) {
        const cur = curById.get(e.id)
        if (!cur) continue
        if (
          cur.position !== e.position ||
          cur.notes !== e.notes ||
          cur.superset_group !== e.superset_group ||
          cur.started_at !== e.started_at ||
          cur.ended_at !== e.ended_at
        ) {
          const { error } = await supabase
            .from('workout_exercises')
            .update({
              position: e.position,
              notes: e.notes,
              superset_group: e.superset_group,
              started_at: e.started_at,
              ended_at: e.ended_at,
            })
            .eq('id', e.id)
          if (error) throw error
        }
      }

      // 3. Exercises deleted this session → re-insert (fresh ids), then re-add
      //    their snapshot sets under the new ids. PostgREST returns inserted
      //    rows in input order, so we zip old→new by index.
      const removedEx = snapshot.exercises.filter((e) => !curById.has(e.id))
      const remap = new Map<string, string>()
      if (removedEx.length) {
        const { data: ins, error } = await supabase
          .from('workout_exercises')
          .insert(removedEx.map(exRow))
          .select('id')
        if (error) throw error
        const rows = (ins ?? []) as { id: string }[]
        removedEx.forEach((e, i) => remap.set(e.id, rows[i].id))
        const reSets = snapshot.sets
          .filter((s) => s.workout_exercise_id && remap.has(s.workout_exercise_id))
          .map((s) => setRow(s, remap.get(s.workout_exercise_id!)!))
        if (reSets.length) {
          const { error: se } = await supabase.from('workout_sets').insert(reSets)
          if (se) throw se
        }
      }

      // 4. Sets under exercises that survived the visit — diff by set id.
      const survived = (weId: string | null) =>
        weId != null && curById.has(weId) && snapExIds.has(weId)
      const snapSets = snapshot.sets.filter((s) => survived(s.workout_exercise_id))
      const curSets = current.sets.filter((s) => survived(s.workout_exercise_id))
      const snapSetById = new Map<string, WorkoutSet>(
        snapSets.map((s) => [s.id, s] as const),
      )
      const curSetIds = new Set(curSets.map((s) => s.id))

      // 4a. Sets added this session → delete.
      const addedSets = curSets.filter((s) => !snapSetById.has(s.id))
      if (addedSets.length) {
        const { error } = await supabase
          .from('workout_sets')
          .delete()
          .in('id', addedSets.map((s) => s.id))
        if (error) throw error
      }
      // 4b. Sets deleted this session → re-insert under their (surviving) parent.
      const removedSets = snapSets.filter((s) => !curSetIds.has(s.id))
      if (removedSets.length) {
        const { error } = await supabase
          .from('workout_sets')
          .insert(removedSets.map((s) => setRow(s, s.workout_exercise_id)))
        if (error) throw error
      }
      // 4c. Sets present but changed → restore their values.
      for (const s of snapSets) {
        const cur = curSets.find((c) => c.id === s.id)
        if (!cur) continue
        if (
          cur.set_number !== s.set_number ||
          cur.reps !== s.reps ||
          cur.weight_lb !== s.weight_lb ||
          cur.duration_sec !== s.duration_sec ||
          cur.distance !== s.distance ||
          cur.effort !== s.effort ||
          cur.is_warmup !== s.is_warmup ||
          (cur.feel ?? null) !== (s.feel ?? null) ||
          (cur.pain ?? null) !== (s.pain ?? null)
        ) {
          const { error } = await supabase
            .from('workout_sets')
            .update({
              set_number: s.set_number,
              reps: s.reps,
              weight_lb: s.weight_lb,
              duration_sec: s.duration_sec,
              distance: s.distance,
              effort: s.effort,
              is_warmup: s.is_warmup,
              feel: s.feel ?? null,
              pain: s.pain ?? null,
            })
            .eq('id', s.id)
          if (error) throw error
        }
      }

      // 5. Restore the workout's rest timer (editable on this page).
      const { error: we } = await supabase
        .from('workouts')
        .update({ rest_seconds: snapshot.rest_seconds })
        .eq('id', workoutId)
      if (we) throw we
      return { workoutId }
    },
    onSuccess: ({ workoutId }) => {
      qc.invalidateQueries({ queryKey: ['workout', workoutId] })
      qc.invalidateQueries({ queryKey: ['workouts'] })
    },
  })
}

/** Add an exercise to a workout: matches last time's set count (blank reps/weight); optionally supersets with another. */
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

      // If this lift has a strength goal, prefill the suggested weight/reps for
      // the upcoming session (instead of the usual blank "match last time").
      const { data: goalRow } = await supabase
        .from('strength_goals')
        .select('*')
        .eq('exercise_key', key)
        .maybeSingle()
      const goal = goalRow as StrengthGoal | null
      let suggested:
        | { weightLb: number | null; reps: number | null }[]
        | null = null
      if (goal) {
        const order: string[] = []
        const byWorkout = new Map<
          string,
          { weight_lb: number | null; reps: number | null; effort: number | null }[]
        >()
        for (const s of prior) {
          if (!byWorkout.has(s.workout_id)) {
            byWorkout.set(s.workout_id, [])
            order.push(s.workout_id)
          }
          byWorkout
            .get(s.workout_id)!
            .push({ weight_lb: s.weight_lb, reps: s.reps, effort: s.effort })
        }
        const sug = suggestNext(
          goal,
          order.map((wid) => byWorkout.get(wid)!),
        )
        if (sug.sets.length) suggested = sug.sets
      }

      let rows
      if (suggested) {
        rows = suggested.map((s, i) => ({
          workout_id: workoutId,
          workout_exercise_id: (we as WorkoutExercise).id,
          exercise_key: key,
          exercise_name: name,
          set_number: i + 1,
          reps: s.reps,
          weight_lb: s.weightLb,
        }))
      } else if (prior.length) {
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
          reps: null,
          weight_lb: null,
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

/**
 * Stamp start/end timing on every exercise in a superset group at once, so the
 * whole block shares one Start/Done (filters by workout + superset_group).
 */
export function useUpdateSupersetTiming() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      workoutId,
      group,
      patch,
    }: {
      workoutId: string
      group: number
      patch: { started_at?: string | null; ended_at?: string | null }
    }) => {
      const { error } = await supabase
        .from('workout_exercises')
        .update(patch)
        .eq('workout_id', workoutId)
        .eq('superset_group', group)
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
  /** Best estimated 1RM (Epley) of the session — the goal-line/ETA series. */
  e1rm: number
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
        const e1rm = currentE1RM([arr])
        rows.push({ date, max, total, avg, e1rm })
      }
      return rows.sort((a, b) => a.date.localeCompare(b.date))
    },
  })
}

export interface ExerciseSessionSet {
  set_number: number
  reps: number | null
  weight_lb: number | null
  effort: number | null
  /** Post-set feedback — see workout_sets.feel / .pain. */
  feel?: 'good' | 'off' | null
  pain?: string | null
}
export interface ExerciseSession {
  workoutId: string
  date: string
  name: string | null
  notes: string | null
  sets: ExerciseSessionSet[]
}

/** Every past session for one exercise with its actual sets — newest first. */
export function useExerciseSessions(key: string | undefined) {
  return useQuery({
    queryKey: ['exerciseSessions', key],
    enabled: !!key,
    queryFn: async (): Promise<ExerciseSession[]> => {
      const { data: sets, error } = await supabase
        .from('workout_sets')
        .select('workout_id,set_number,reps,weight_lb,effort,feel,pain')
        .eq('exercise_key', key)
      if (error) throw error
      const s = (sets ?? []) as (ExerciseSessionSet & { workout_id: string })[]
      if (!s.length) return []
      const ids = [...new Set(s.map((x) => x.workout_id))]
      const [{ data: ws }, { data: wex }] = await Promise.all([
        supabase.from('workouts').select('id,workout_date,name').in('id', ids),
        supabase
          .from('workout_exercises')
          .select('workout_id,notes')
          .eq('exercise_key', key)
          .in('workout_id', ids)
          .not('notes', 'is', null),
      ])
      const meta = new Map(
        ((ws ?? []) as { id: string; workout_date: string; name: string | null }[]).map(
          (w) => [w.id, { date: w.workout_date, name: w.name }],
        ),
      )
      // Per-session note lives on workout_exercises; if an exercise was logged
      // twice in one workout, join both notes for that session.
      const notesByW = new Map<string, string>()
      for (const r of (wex ?? []) as {
        workout_id: string
        notes: string | null
      }[]) {
        const n = r.notes?.trim()
        if (!n) continue
        const prev = notesByW.get(r.workout_id)
        notesByW.set(r.workout_id, prev ? `${prev}\n${n}` : n)
      }
      const byW = new Map<string, ExerciseSessionSet[]>()
      for (const x of s) {
        const arr = byW.get(x.workout_id) ?? []
        arr.push({
          set_number: x.set_number,
          reps: x.reps,
          weight_lb: x.weight_lb,
          effort: x.effort,
          feel: x.feel ?? null,
          pain: x.pain ?? null,
        })
        byW.set(x.workout_id, arr)
      }
      const rows: ExerciseSession[] = []
      for (const [wid, arr] of byW) {
        const m = meta.get(wid)
        if (!m) continue
        arr.sort((a, b) => a.set_number - b.set_number)
        rows.push({
          workoutId: wid,
          date: m.date,
          name: m.name,
          notes: notesByW.get(wid) ?? null,
          sets: arr,
        })
      }
      return rows.sort((a, b) => b.date.localeCompare(a.date))
    },
  })
}

export interface ExerciseBests {
  /** Heaviest single set ever logged (lb). */
  maxWeight: number
  /** Highest single-set volume ever (reps × weight, lb). */
  maxSetVolume: number
  /** Highest single-session total volume ever (Σ reps × weight, lb). */
  maxSessionVolume: number
}

/**
 * All-time bests for one exercise from PRIOR workouts only (excludes the given
 * workout), so an in-progress session is compared against history — not itself.
 * Returns null when there's nothing to beat yet (no prior sets / all blank), so
 * a first-ever session never counts as a PR. Doesn't refetch on the current
 * workout's edits (it filters that workout out), so the baseline stays stable.
 */
export function useExerciseBests(
  key: string | undefined,
  excludeWorkoutId: string | undefined,
) {
  return useQuery({
    queryKey: ['exerciseBests', key, excludeWorkoutId],
    enabled: !!key,
    queryFn: async (): Promise<ExerciseBests | null> => {
      const { data, error } = await supabase
        .from('workout_sets')
        .select('workout_id,reps,weight_lb')
        .eq('exercise_key', key)
      if (error) throw error
      const rows = (
        (data ?? []) as {
          workout_id: string
          reps: number | null
          weight_lb: number | null
        }[]
      ).filter((r) => r.workout_id !== excludeWorkoutId)
      if (!rows.length) return null
      let maxWeight = 0
      let maxSetVolume = 0
      const volByWorkout = new Map<string, number>()
      for (const r of rows) {
        const w = r.weight_lb ?? 0
        if (w > maxWeight) maxWeight = w
        const v = (r.reps ?? 0) * w
        if (v > maxSetVolume) maxSetVolume = v
        volByWorkout.set(r.workout_id, (volByWorkout.get(r.workout_id) ?? 0) + v)
      }
      const maxSessionVolume = volByWorkout.size
        ? Math.max(...volByWorkout.values())
        : 0
      if (maxWeight <= 0 && maxSetVolume <= 0 && maxSessionVolume <= 0) return null
      return { maxWeight, maxSetVolume, maxSessionVolume }
    },
  })
}
