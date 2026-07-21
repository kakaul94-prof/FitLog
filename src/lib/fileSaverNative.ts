// Bridge to the native FileSaver plugin (Android). saveAs opens the system
// "Save As" dialog (Storage Access Framework) so the user chooses where the
// file goes. Gated on the plugin being present so the web PWA and older APKs
// (live-URL: new JS can run on an APK that predates this plugin) fall back.
import { Capacitor, registerPlugin } from '@capacitor/core'

export interface FileSaverPlugin {
  /** Prompt for a location + filename, then write the text there. */
  saveAs(options: {
    filename: string
    mimeType: string
    data: string
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
  data: string,
): Promise<void> {
  await FileSaver.saveAs({ filename, mimeType, data })
}
