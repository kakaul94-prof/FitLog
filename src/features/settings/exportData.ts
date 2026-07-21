import { supabase } from '@/lib/supabase'
import { Capacitor } from '@capacitor/core'
import { canSaveAsNative, saveAsNative } from '@/lib/fileSaverNative'

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

export type ExportResult =
  /** Web/PWA: the browser download was triggered. */
  | { saved: false }
  /**
   * Native save. `location` is set only when the app picked the folder itself
   * (Documents fallback); with the Save-As dialog the user chose, so it's left
   * out and the confirmation just names the file.
   */
  | { saved: true; filename: string; location?: string }

/** True inside the packaged app AND when this APK bundles the Filesystem plugin. */
const canSaveNative = () =>
  Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Filesystem')

/** Pull every owner-scoped table into one JSON string. */
async function gatherJson(): Promise<string> {
  const out: Record<string, unknown> = {
    app: 'FitLog',
    exported_at: new Date().toISOString(),
  }
  for (const t of TABLES) {
    const { data, error } = await supabase.from(t).select('*')
    if (error) throw error
    out[t] = data ?? []
  }
  return JSON.stringify(out, null, 2)
}

/** Web/PWA: hand the blob to the browser via a temporary <a download>. */
function downloadWeb(json: string, name: string) {
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke after the click has been dispatched, not synchronously — some
  // browsers cancel an in-flight download if the URL disappears too soon.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Native (Android WebView): a blob <a download> is a silent no-op there, so
 * write the file into the device's public Documents folder. On Android 11+ the
 * app can freely create its own files there with no permission prompt, and the
 * user can open it from the Files app → Documents. `import()` keeps the plugin
 * out of the web bundle.
 */
async function saveNative(json: string, name: string): Promise<string> {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
  await Filesystem.writeFile({
    path: name,
    data: json,
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
  })
  return 'Documents'
}

/** Export all of the user's data as a single JSON file (data ownership/backup). */
export async function exportData(): Promise<ExportResult> {
  const json = await gatherJson()
  const filename = `fitlog-export-${new Date().toISOString().slice(0, 10)}.json`
  if (canSaveAsNative()) {
    // Let the user choose the folder + name via the system Save-As dialog.
    await saveAsNative(filename, 'application/json', json)
    return { saved: true, filename }
  }
  if (canSaveNative()) {
    // Older APK (has Filesystem but not the Save-As dialog yet): drop it in the
    // Documents folder so export still works until the new APK is installed.
    const location = await saveNative(json, filename)
    return { saved: true, filename, location }
  }
  if (Capacitor.isNativePlatform()) {
    // In the app but on an APK that predates the file plugin: the browser
    // download path can't work inside the WebView, so say so instead of
    // appearing to do nothing.
    throw new Error(
      'Update the FitLog app to the latest version to export your data.',
    )
  }
  downloadWeb(json, filename)
  return { saved: false }
}
