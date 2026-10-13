import { useRef } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Insert one row whose id the app chose, and return the saved row. A repeat of
 * a save whose first attempt already reached the server (its reply was lost
 * and you tapped again, a double tap, the offline queue replaying after a
 * restart) is refused on its own id (23505). That's the same save, so the row
 * the first attempt stored is returned instead of an error. Only your own rows
 * are visible, so another user's row with the same id never counts.
 */
export async function insertOnce<T>(table: string, row: { id: string }): Promise<T> {
  const { data, error } = await supabase.from(table).insert(row).select('*').single()
  if (!error) return data as T
  if (error.code === '23505') {
    const { data: saved } = await supabase.from(table).select('*').eq('id', row.id).maybeSingle()
    if (saved) return saved as T
  }
  throw error
}

/**
 * The id for a form's create request, kept while the same values are sent
 * again (a retry after a failed or lost reply, a double tap) so the server
 * sees a repeat as the same row. Changed values or a finished save start a
 * new one, so logging the same thing again on purpose is a new row.
 */
export function useSubmissionId() {
  const last = useRef<{ id: string; values: string } | null>(null)
  return {
    idFor(values: unknown): string {
      const key = JSON.stringify(values)
      if (last.current?.values !== key) last.current = { id: crypto.randomUUID(), values: key }
      return last.current.id
    },
    clear(): void {
      last.current = null
    },
  }
}
