import { decodeImage, encodeCanvas, makeCanvas, THUMB_QUALITY } from '../attachments/media/image.ts'

// A picked photo becomes a small square picture for member_avatars: centre-cropped, scaled to at most 256 px,
// re-encoded as WebP (or JPEG where the browser cannot) and returned as a data: URL. It reuses the attachments
// feature's browser image code, which already decodes upright (EXIF rotation) and strips the photo's metadata,
// GPS included. The database accepts at most 120000 characters; this aims well below it.

export const AVATAR_SIZE = 256
export const AVATAR_MAX_CHARS = 100_000
const TRIES = [THUMB_QUALITY, { webp: 0.6, jpeg: 0.65 }, { webp: 0.45, jpeg: 0.5 }]

// The largest centred square of a picture: where it starts and how long a side is.
export function squareCrop(width: number, height: number): { sx: number; sy: number; side: number } {
  const side = Math.max(1, Math.min(width, height))
  return { sx: Math.floor((width - side) / 2), sy: Math.floor((height - side) / 2), side }
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The picture could not be read.'))
    reader.readAsDataURL(blob)
  })
}

export async function pictureToAvatar(file: Blob): Promise<string> {
  let bitmap: ImageBitmap
  try {
    bitmap = await decodeImage(file)
  } catch {
    throw new Error('That file could not be read as a picture. Try a JPEG or PNG.')
  }
  try {
    const { sx, sy, side } = squareCrop(bitmap.width, bitmap.height)
    const size = Math.min(AVATAR_SIZE, side)
    const canvas = makeCanvas(size, size)
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (!ctx) throw new Error('The picture could not be prepared.')
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size)
    for (const quality of TRIES) {
      const { blob } = await encodeCanvas(canvas, quality)
      const url = await toDataUrl(blob)
      if (url.length <= AVATAR_MAX_CHARS) return url
    }
    throw new Error('That picture is too detailed to shrink enough. Try another one.')
  } finally {
    bitmap.close?.()
  }
}
