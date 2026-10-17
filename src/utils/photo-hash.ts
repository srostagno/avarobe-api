import { createHash } from 'node:crypto'

import sharp from 'sharp'

// The same photo again (Look Score, Hair Score): the normalized file's
// sha256, and a 64-bit difference hash (9x8 grey, each pixel against the one
// to its right) that survives re-encoding, resizing and a light crop. Never
// a face template: it's the whole picture, and it's only compared with her
// own photos of the same kind.

export function photoSha256(photo: Buffer) {
  return createHash('sha256').update(photo).digest('hex')
}

export async function differenceHash(photo: Buffer) {
  const data = await sharp(photo).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer()
  let bits = 0n

  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      bits = (bits << 1n) | (data[row * 9 + column]! > data[row * 9 + column + 1]! ? 1n : 0n)
    }
  }

  return bits.toString(16).padStart(16, '0')
}

// Bits that differ between two difference hashes (0 = the same picture).
export function hashDistance(a: string, b: string) {
  let diff = BigInt(`0x${a}`) ^ BigInt(`0x${b}`)
  let count = 0

  while (diff > 0n) {
    count += Number(diff & 1n)
    diff >>= 1n
  }

  return count
}
