// The day a photo was taken, from its EXIF (DateTimeOriginal, else
// DateTime): Look Great dates an old photo by it. `exif` is sharp's
// metadata().exif, with or without its "Exif\0\0" header. Null when the
// photo carries none (most photos sent through WhatsApp) or it's unreadable.

const DATE_TIME = 0x0132
const EXIF_IFD = 0x8769
const DATE_TIME_ORIGINAL = 0x9003
const ASCII = 2
const LONG = 4

export function exifDate(exif: Buffer | undefined | null): Date | null {
  if (!exif || exif.length < 14) {
    return null
  }

  const tiff = exif.subarray(0, 6).toString('latin1') === 'Exif\0\0' ? exif.subarray(6) : exif

  try {
    const order = tiff.subarray(0, 2).toString('latin1')

    if (order !== 'II' && order !== 'MM') {
      return null
    }

    const little = order === 'II'
    const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at))
    const u32 = (at: number) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at))

    // Each entry: tag, type, count, then the value or its offset.
    const entries = (ifd: number) => {
      const count = u16(ifd)
      const list: { tag: number; type: number; count: number; value: number }[] = []

      for (let index = 0; index < count; index += 1) {
        const at = ifd + 2 + index * 12
        list.push({ tag: u16(at), type: u16(at + 2), count: u32(at + 4), value: u32(at + 8) })
      }

      return list
    }
    const text = (entry: { type: number; count: number; value: number }) =>
      entry.type === ASCII && entry.count >= 19 ? tiff.subarray(entry.value, entry.value + 19).toString('latin1') : null

    const ifd0 = entries(u32(4))
    const exifPointer = ifd0.find((entry) => entry.tag === EXIF_IFD && entry.type === LONG)
    const original = exifPointer ? entries(exifPointer.value).find((entry) => entry.tag === DATE_TIME_ORIGINAL) : undefined
    const plain = ifd0.find((entry) => entry.tag === DATE_TIME)

    return parseExifDate((original && text(original)) ?? (plain && text(plain)) ?? null)
  } catch {
    return null
  }
}

// 'YYYY:MM:DD HH:MM:SS' → that day (UTC midnight), from 1990 to today.
export function parseExifDate(value: string | null): Date | null {
  const match = value ? /^(\d{4}):(\d{2}):(\d{2})/.exec(value) : null

  if (!match) {
    return null
  }

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  const valid = date.toISOString().slice(0, 10) === `${match[1]}-${match[2]}-${match[3]}`

  return valid && date.getUTCFullYear() >= 1990 && date.getTime() <= Date.now() ? date : null
}
