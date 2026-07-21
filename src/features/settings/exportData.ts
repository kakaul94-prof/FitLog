import { supabase } from '@/lib/supabase'
import { Capacitor } from '@capacitor/core'

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

/** True inside the packaged app AND when this APK bundles the file plugins. */
const canShareNative = () =>
  Capacitor.isNativePlatform() &&
  Capacitor.isPluginAvailable('Filesystem') &&
  Capacitor.isPluginAvailable('Share')

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
 * write the file to app cache and open the share sheet — the user can then save
 * it to Files/Drive/email. `import()` keeps the plugins out of the web bundle.
 */
async function shareNative(json: string, name: string) {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')
  const { uri } = await Filesystem.writeFile({
    path: name,
    data: json,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  })
  await Share.share({
    title: 'FitLog data export',
    url: uri,
    dialogTitle: 'Save or share your FitLog backup',
  })
}

/** Export all of the user's data as a single JSON file (data ownership/backup). */
export async function exportData() {
  const json = await gatherJson()
  const name = `fitlog-export-${new Date().toISOString().slice(0, 10)}.json`
  if (canShareNative()) {
    await shareNative(json, name)
  } else if (Capacitor.isNativePlatform()) {
    // In the app but on an APK that predates the file plugins: the browser
    // download path can't work inside the WebView, so say so instead of
    // appearing to do nothing.
    throw new Error(
      'Update the FitLog app to the latest version to export your data.',
    )
  } else {
    downloadWeb(json, name)
  }
}
