import { useMemo } from 'react'
import { useProfile } from '@/features/profile/useProfile'
import { useExerciseEntriesRange } from './useExercise'
import { todayISO } from '@/lib/date'
import { weekStartISO } from '@/lib/cardio'
import {
  DEFAULT_CARDIO_GOAL,
  resolveCardioGoal,
  summarizeCardioWeek,
  type CardioWeekSummary,
} from '@/lib/cardioGoal'
import type { CardioGoal } from '@/lib/database.types'

export interface WeeklyCardioGoal {
  /** The saved goal, or null when none has been set. */
  goal: CardioGoal | null
  /** This week's rollup — against the saved goal, or the default when unset so
   *  an empty-state card can still preview what a goal would look like. */
  summary: CardioWeekSummary
  /** Monday of the current week (the rollup window start). */
  weekStart: string
  isLoading: boolean
}

/**
 * This week's cardio measured against the weekly goal. Reads `exercise_entries`
 * Mon–today, so it counts cardio logged in the diary and cardio logged from a
 * programmed workout identically (programmed cardio items write normal entries
 * — see WorkoutPage). Shared by Progress → Cardio and the Program page.
 */
export function useWeeklyCardioGoal(): WeeklyCardioGoal {
  const today = todayISO()
  const weekStart = weekStartISO(today)
  const { data: entries, isLoading } = useExerciseEntriesRange(weekStart, today)
  const { data: profile } = useProfile()

  const goal = useMemo(
    () =>
      resolveCardioGoal(
        profile?.cardio_goal,
        profile?.weekly_cardio_min_target,
      ),
    [profile?.cardio_goal, profile?.weekly_cardio_min_target],
  )
  const summary = useMemo(
    () => summarizeCardioWeek(entries ?? [], goal ?? DEFAULT_CARDIO_GOAL),
    [entries, goal],
  )

  return { goal, summary, weekStart, isLoading }
}
