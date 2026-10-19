import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { CheckinSwap, WorkoutCheckin } from '@/lib/database.types'

/** Put a check-in swap back: the exercise and any sets already logged under it
 *  return to the original lift, and the swap drops off the check-in record. */
export function useUndoSwap() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      workoutId,
      exerciseId,
      swap,
      checkin,
    }: {
      workoutId: string
      exerciseId: string
      swap: CheckinSwap
      checkin: WorkoutCheckin
    }) => {
      const back = { exercise_key: swap.fromKey, exercise_name: swap.fromName }
      const { error: e1 } = await supabase
        .from('workout_exercises')
        .update(back)
        .eq('id', exerciseId)
      if (e1) throw e1
      const { error: e2 } = await supabase
        .from('workout_sets')
        .update(back)
        .eq('workout_exercise_id', exerciseId)
      if (e2) throw e2
      const { error: e3 } = await supabase
        .from('workouts')
        .update({
          checkin: { ...checkin, swaps: checkin.swaps.filter((s) => s !== swap) },
        })
        .eq('id', workoutId)
      if (e3) throw e3
      return workoutId
    },
    onSuccess: (id) => qc.invalidateQueries({ queryKey: ['workout', id] }),
  })
}
