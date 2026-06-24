import { supabase } from '@/lib/supabase'
import { TABLES } from './exportData'

/** Per-table row counts for the confirm step. */
export type BackupCounts = { table: string; count: number }[]

export type ParsedBackup = {
  data: Record<string, Record<string, unknown>[]>
  counts: BackupCounts
}

/**
 * Parse + sanity-check an exported backup before any destructive action.
 * Only keeps keys we know how to restore (TABLES); a table that's present must
 * be an array, but a missing one is fine (older backups predate some tables and
 * are simply left untouched on restore). Throws on anything that isn't a
 * plausible FitLog export.
 */
export function validateBackup(text: string): ParsedBackup {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('That file isn’t valid JSON.')
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as Record<string, unknown>).app !== 'FitLog'
  ) {
    throw new Error('That doesn’t look like a FitLog backup.')
  }
  const obj = parsed as Record<string, unknown>
  const data: Record<string, Record<string, unknown>[]> = {}
  const counts: BackupCounts = []
  for (const t of TABLES) {
    const v = obj[t]
    if (v === undefined) continue
    if (!Array.isArray(v)) {
      throw new Error(`Backup is malformed: "${t}" should be a list.`)
    }
    data[t] = v as Record<string, unknown>[]
    counts.push({ table: t, count: v.length })
  }
  if (counts.length === 0) {
    throw new Error('Backup contains no recognizable data.')
  }
  return { data, counts }
}

const BATCH = 500

/**
 * Replace all of the user's data with the backup (a true "restore", not a
 * merge): wipe each table present in the file, then re-insert its rows keeping
 * their original ids so foreign keys stay intact. user_id is forced to the
 * current account so a backup also restores into a fresh account after data
 * loss. NOT transactional — a mid-way failure leaves partial state; re-running
 * the same file wipes and retries cleanly.
 */
export async function restoreBackup(
  parsed: ParsedBackup,
  userId: string,
): Promise<void> {
  const { data } = parsed
  const present = TABLES.filter((t) => Array.isArray(data[t]))

  // Wipe children-first (reverse of parents-first). Skip profiles: it's
  // auto-created per account and is upserted in place below, not deleted.
  for (const t of [...present].reverse()) {
    if (t === 'profiles') continue
    const { error } = await supabase.from(t).delete().not('id', 'is', null)
    if (error) throw new Error(`Couldn’t clear ${t}: ${error.message}`)
  }

  // Re-insert parents-first.
  for (const t of present) {
    const rows = data[t]
    if (t === 'profiles') {
      const row = rows[0]
      if (row) {
        const { error } = await supabase
          .from('profiles')
          .upsert({ ...row, id: userId }, { onConflict: 'id' })
        if (error) throw new Error(`Couldn’t restore profile: ${error.message}`)
      }
      continue
    }
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows
        .slice(i, i + BATCH)
        .map((r) => ({ ...r, user_id: userId }))
      const { error } = await supabase.from(t).insert(chunk)
      if (error) throw new Error(`Couldn’t restore ${t}: ${error.message}`)
    }
  }
}
