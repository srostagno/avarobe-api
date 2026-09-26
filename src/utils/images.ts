import sharp from 'sharp'

const MIN_SELFIE_EDGE = 320

export class InvalidImageError extends Error {}

// Normalizes an uploaded photo: applies EXIF rotation, caps the size and
// re-encodes as JPEG. sharp drops all metadata by default, which removes the
// GPS location phones embed in photos.
export async function normalizeSelfie(input: Buffer) {
  let image: sharp.Sharp

  try {
    image = sharp(input, { failOn: 'error' }).rotate()
  } catch {
    throw new InvalidImageError('That file is not an image we can read.')
  }

  const metadata = await image.metadata().catch(() => null)

  if (!metadata?.width || !metadata.height) {
    throw new InvalidImageError('That file is not an image we can read.')
  }

  if (Math.min(metadata.width, metadata.height) < MIN_SELFIE_EDGE) {
    throw new InvalidImageError(
      `The photo is too small. Use one at least ${MIN_SELFIE_EDGE}px on each side.`,
    )
  }

  return image
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()
}

export async function toStoredWebp(png: Buffer) {
  return sharp(png).webp({ quality: 90 }).toBuffer()
}

export async function toModelPng(image: Buffer) {
  return sharp(image).png().toBuffer()
}
