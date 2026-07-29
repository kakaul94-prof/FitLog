import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ProgressionMethod, StrengthGoal } from '@/lib/database.types'
import { currentE1RM, suggestNext, type Suggestion } from '@/lib/progression'

/** The strength goal for one exercise (built-in slug or 'custom:<uuid>'), if any. */
export function useStrengthGoal(key: string | undefined) {
  return useQuery({
    queryKey: ['strengthGoal', key],
    enabled: !!key,
    queryFn: async (): Promise<StrengthGoal | null> => {
      const { data, error } = await supabase
        .from('strength_goals')
        .select('*')
        .eq('exercise_key', key)
        .maybeSingle()
      if (error) throw error
      return (data as StrengthGoal | null) ?? null
    },
  })
}

/**
 * Every strength goal keyed by exercise_key, in ONE query — the workout page's
 * in-session coach needs each lift's method / rep range / increment, and a
 * per-card query would mean one round trip per exercise.
 */
export function useStrengthGoalMap() {
  return useQuery({
    queryKey: ['strengthGoalMap'],
    queryFn: async (): Promise<Map<string, StrengthGoal>> => {
      const { data, error } = await supabase.from('strength_goals').select('*')
      if (error) throw error
      return new Map(
        ((data ?? []) as StrengthGoal[]).map((g) => [g.exercise_key, g] as const),
      )
    },
  })
}

export interface NewStrengthGoal {
  exercise_key: string
  exercise_name: string
  target_1rm_lb: number
  target_weight_lb: number
  target_reps: number
  method: ProgressionMethod
  increment_lb: number
  rep_low: number
  rep_high: number
  sets: number
  target_date?: string | null
}

export function useSaveStrengthGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (g: NewStrengthGoal): Promise<StrengthGoal> => {
      const { data, error } = await supabase
        .from('strength_goals')
        .insert(g)
        .select('*')
        .single()
      if (error) throw error
      return data as StrengthGoal
    },
    onSuccess: (g) => {
      qc.invalidateQueries({ queryKey: ['strengthGoal', g.exercise_key] })
      qc.invalidateQueries({ queryKey: ['strengthGoalsOverview'] })
      qc.invalidateQueries({ queryKey: ['strengthGoalMap'] })
    },
  })
}

/** Patch a goal by id (method switch, edits, 5/3/1 week/cycle/TM advance). */
export function useUpdateStrengthGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      exercise_key,
      ...patch
    }: { id: string; exercise_key: string } & Partial<StrengthGoal>) => {
      const { error } = await supabase
        .from('strength_goals')
        .update(patch)
        .eq('id', id)
      if (error) throw error
      return { exercise_key }
    },
    onSuccess: ({ exercise_key }) => {
      qc.invalidateQueries({ queryKey: ['strengthGoal', exercise_key] })
      qc.invalidateQueries({ queryKey: ['strengthGoalsOverview'] })
      qc.invalidateQueries({ queryKey: ['strengthGoalMap'] })
    },
  })
}

export function useDeleteStrengthGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      exercise_key,
    }: {
      id: string
      exercise_key: string
    }) => {
      const { error } = await supabase.from('strength_goals').delete().eq('id', id)
      if (error) throw error
      return { exercise_key }
    },
    onSuccess: ({ exercise_key }) => {
      qc.invalidateQueries({ queryKey: ['strengthGoal', exercise_key] })
      qc.invalidateQueries({ queryKey: ['strengthGoalsOverview'] })
      qc.invalidateQueries({ queryKey: ['strengthGoalMap'] })
    },
  })
}

export interface GoalOverview {
  goal: StrengthGoal
  /** Current best e1RM derived live from logged sets (0 = no history). */
  current: number
  /** Progress toward target, 0–100. */
  pct: number
  reached: boolean
  /** Suggested next session (same engine as the detail page). */
  sug: Suggestion
}

/**
 * Every strength goal with its live progress + next-session suggestion, for the
 * Goals overview page. Batches all goals' sessions in 3 queries regardless of
 * goal count: goals, then their sets by exercise_key, then the workout dates to
 * order sessions newest-first (currentE1RM / suggestNext both want recent-first).
 */
export function useStrengthGoalsOverview() {
  return useQuery({
    queryKey: ['strengthGoalsOverview'],
    queryFn: async (): Promise<GoalOverview[]> => {
      const { data: goalRows, error } = await supabase
        .from('strength_goals')
        .select('*')
        .order('exercise_name')
      if (error) throw error
      const goals = (goalRows ?? []) as StrengthGoal[]
      if (!goals.length) return []

      const keys = [...new Set(goals.map((g) => g.exercise_key))]
      const { data: setRows, error: se } = await supabase
        .from('workout_sets')
        .select('exercise_key,workout_id,reps,weight_lb,effort')
        .in('exercise_key', keys)
      if (se) throw se
      const sets = (setRows ?? []) as {
        exercise_key: string
        workout_id: string
        reps: number | null
        weight_lb: number | null
        effort: number | null
      }[]

      const wids = [...new Set(sets.map((s) => s.workout_id))]
      const dateById = new Map<string, string>()
      if (wids.length) {
        const { data: ws } = await supabase
          .from('workouts')
          .select('id,workout_date')
          .in('id', wids)
        for (const w of (ws ?? []) as { id: string; workout_date: string }[])
          dateById.set(w.id, w.workout_date)
      }

      // exercise_key → (workout_id → sets); each workout is one session.
      const byKey = new Map<
        string,
        Map<
          string,
          { weight_lb: number | null; reps: number | null; effort: number | null }[]
        >
      >()
      for (const s of sets) {
        let m = byKey.get(s.exercise_key)
        if (!m) {
          m = new Map()
          byKey.set(s.exercise_key, m)
        }
        const arr = m.get(s.workout_id) ?? []
        arr.push({ weight_lb: s.weight_lb, reps: s.reps, effort: s.effort })
        m.set(s.workout_id, arr)
      }

      return goals.map((goal) => {
        const m = byKey.get(goal.exercise_key)
        const sessions = m
          ? [...m.entries()]
              .sort((a, b) =>
                (dateById.get(b[0]) ?? '').localeCompare(dateById.get(a[0]) ?? ''),
              )
              .map(([, v]) => v)
          : []
        const current = currentE1RM(sessions)
        const pct = Math.min(
          100,
          Math.max(0, Math.round((current / goal.target_1rm_lb) * 100)) || 0,
        )
        return {
          goal,
          current,
          pct,
          reached: current > 0 && current >= goal.target_1rm_lb,
          sug: suggestNext(goal, sessions),
        }
      })
    },
  })
}
