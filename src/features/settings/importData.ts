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

/**
 * Replace all of the user's data with the backup (a true "restore", not a
 * merge) in ONE call: restore_backup (supabase/migration_restore_backup.sql)
 * wipes each table present in the file and re-inserts its rows with their
 * original ids, so links between them hold, stamped as the current user's, so
 * a backup also restores into a fresh account. It runs as one transaction: if
 * anything fails, nothing has changed. (It used to be many requests, and a
 * failure part-way left the account half-restored.)
 */
export async function restoreBackup(parsed: ParsedBackup): Promise<void> {
  const { error } = await supabase.rpc('restore_backup', { backup: parsed.data })
  if (!error) return
  // The function is missing until the migration has run on this database.
  if (error.code === 'PGRST202')
    throw new Error(
      'Couldn’t restore: the database needs an update first (migration_restore_backup.sql). Nothing was changed.',
    )
  throw new Error(`Couldn’t restore: ${error.message}. Nothing was changed.`)
}
