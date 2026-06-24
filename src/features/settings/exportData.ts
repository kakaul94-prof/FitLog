import { supabase } from '@/lib/supabase'

// All owner-scoped data tables, ordered PARENTS-FIRST so a restore can reuse
// this list for FK-safe inserts (export itself is order-independent).
// Excludes form_videos: that row only points at a binary in Storage, which a
// JSON backup can't carry — so it's left out to keep export/restore symmetric.
export const TABLES = [
  'profiles',
  'foods',
  'recipe_ingredients',
  'diary_entries',
  'meals',
  'meal_items',
  'custom_activities',
  'exercise_entries',
  'custom_exercises',
  'exercise_notes',
  'strength_goals',
  'routines',
  'routine_exercises',
  'workouts',
  'workout_exercises',
  'workout_sets',
  'measurements',
]

/** Download all of the user's data as a single JSON file (data ownership/backup). */
export async function exportData() {
  const out: Record<string, unknown> = {
    app: 'FitLog',
    exported_at: new Date().toISOString(),
  }
  for (const t of TABLES) {
    const { data, error } = await supabase.from(t).select('*')
    if (error) throw error
    out[t] = data ?? []
  }
  const blob = new Blob([JSON.stringify(out, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `fitlog-export-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
