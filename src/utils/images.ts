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

// Full-body photos keep more pixels than selfies: proportions matter more
// than face detail there.
export async function normalizeBodyPhoto(input: Buffer) {
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
      `The full-body photo is too small. Use one at least ${MIN_SELFIE_EDGE}px on each side.`,
    )
  }

  return image
    .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer()
}

// Outfit photos for try-ons: screenshots from stores, Pinterest, a friend's
// photo. Only the clothes matter, so they can be smaller than a selfie.
export async function normalizeOutfitPhoto(input: Buffer) {
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

  if (Math.min(metadata.width, metadata.height) < 256) {
    throw new InvalidImageError('The photo is too small. Use one at least 256px on each side.')
  }

  return image
    .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer()
}

// Small, quick-to-load version of an in-progress render.
export async function toPreviewWebp(png: Buffer) {
  return sharp(png).resize({ width: 512 }).webp({ quality: 70 }).toBuffer()
}

export async function toStoredWebp(png: Buffer) {
  return sharp(png).webp({ quality: 90 }).toBuffer()
}

// The free best-vs-worst photo before it's unlocked: the left half (their
// best color) blurred and nearly grey, so neither the face in it nor the
// color can be made out; the right half (their worst) untouched.
export async function lockBestSide(image: Buffer) {
  const { width = 0, height = 0 } = await sharp(image).metadata()
  const half = Math.floor(width / 2)
  const blurred = await sharp(image)
    .extract({ left: 0, top: 0, width: half, height })
    .blur(48)
    .modulate({ saturation: 0.08, brightness: 1.04 })
    .toBuffer()

  return sharp(image).composite([{ input: blurred, left: 0, top: 0 }]).webp({ quality: 86 }).toBuffer()
}

export async function toModelPng(image: Buffer) {
  return sharp(image).png().toBuffer()
}
