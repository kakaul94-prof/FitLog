// Bridge to the native FileSaver plugin (Android). saveAs opens the system
// "Save As" dialog (Storage Access Framework) so the user chooses where the
// file goes, then the plugin streams the staged temp file into that location.
// Gated on the plugin being present so the web PWA and older APKs (live-URL:
// new JS can run on an APK that predates this plugin) fall back.
import { Capacitor, registerPlugin } from '@capacitor/core'

export interface FileSaverPlugin {
  /**
   * Prompt for a location + filename, then copy `sourceUri` (a file:// URI to a
   * staged temp file) there. Passing a URI instead of the payload keeps the
   * whole export out of the bridge and out of native memory (avoids OOM).
   */
  saveAs(options: {
    filename: string
    mimeType: string
    sourceUri: string
  }): Promise<{ uri: string }>
}

const FileSaver = registerPlugin<FileSaverPlugin>('FileSaver')

/** True only when the packaged app bundles the FileSaver plugin. */
export const canSaveAsNative = () =>
  Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('FileSaver')

/** Open the native Save-As dialog. Rejects with "cancelled" if dismissed. */
export async function saveAsNative(
  filename: string,
  mimeType: string,
  sourceUri: string,
): Promise<void> {
  await FileSaver.saveAs({ filename, mimeType, sourceUri })
}
