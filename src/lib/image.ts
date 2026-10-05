// On-device image prep shared by the scanners (label + meal photo): downscale +
// re-encode to a smaller, EXIF-oriented JPEG, returned as base64 (no data: URL
// prefix). Keeps the upload small and the payload shape uniform for the scan
// Functions.

const MAX_DIM = 1500

export async function prepareImage(file: File, maxDim = MAX_DIM): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Image processing not supported on this device.')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85),
  )
  if (!blob) throw new Error('Could not process the image.')
  return toBase64(await blob.arrayBuffer())
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}
