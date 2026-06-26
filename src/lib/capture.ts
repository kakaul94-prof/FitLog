import { Capacitor } from '@capacitor/core'

// Native capture helpers with a graceful web fallback. The app is loaded from a
// remote URL (capacitor.config `server.url`), so we return images as DataUrls to
// avoid cross-origin fetches of `capacitor://` file paths, and we gate every
// native call on the plugin actually being present in the installed APK — an
// older build (or the browser PWA) falls back to the hidden file input.

export const canNativeCamera = () =>
  Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Camera')

export const canNativeBarcode = () =>
  Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('BarcodeScanner')

/** User backed out of the camera/scanner — not a real error to surface. */
export function isUserCancel(err: unknown): boolean {
  return err instanceof Error && /cancel/i.test(err.message)
}

function dataUrlToFile(dataUrl: string, name: string): File {
  const comma = dataUrl.indexOf(',')
  const mime = /data:(.*?)[;,]/.exec(dataUrl)?.[1] || 'image/jpeg'
  const bin = atob(dataUrl.slice(comma + 1))
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new File([arr], name, { type: mime })
}

/** Open the native camera; return the shot as a JPEG File (null if none). */
export async function captureLabelPhoto(): Promise<File | null> {
  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')
  const photo = await Camera.getPhoto({
    source: CameraSource.Camera,
    resultType: CameraResultType.DataUrl,
    quality: 90,
    correctOrientation: true,
  })
  return photo.dataUrl ? dataUrlToFile(photo.dataUrl, 'label.jpg') : null
}

/** Open the native ML Kit live scanner; return the first barcode value (or null). */
export async function scanBarcodeNative(): Promise<string | null> {
  const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning')
  const { barcodes } = await BarcodeScanner.scan()
  return barcodes[0]?.rawValue?.trim() || null
}
