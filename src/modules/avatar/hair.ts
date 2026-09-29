import type { AvatarDocument, AvatarHair, AvatarVersion } from '../../types/mongo.js'
import type { ImageInput } from '../../utils/openai.js'
import { storage } from '../../utils/storage.js'

// A haircut from the Hair studio lives on the avatar version that wears it,
// so switching versions switches the hair too.
export function currentHair(avatar: Pick<AvatarDocument, 'avatarKey' | 'versions'>): AvatarHair | null {
  if (!avatar.avatarKey) {
    return null
  }

  return avatar.versions?.find((version) => version.key === avatar.avatarKey)?.hair ?? null
}

// Renders that take the selfie as a close-up of the face would bring back
// the hair in it. With a new haircut, a close-up of that haircut goes last
// (as image `imageNumber`) with a line saying which hair wins.
export async function hairReference(
  avatar: Pick<AvatarDocument, 'avatarKey' | 'versions'>,
  imageNumber: number,
): Promise<{ image: ImageInput; line: string } | null> {
  const hair = currentHair(avatar)

  if (!hair) {
    return null
  }

  try {
    const data = await storage.read(hair.refKey)

    return {
      image: { data, filename: 'hair.webp', contentType: 'image/webp' },
      line: `Image ${imageNumber} is a close-up of their current haircut (${hair.name}): give them exactly this haircut, length, texture and color, not the hair in image 2.`,
    }
  } catch {
    return null
  }
}

// Refinements keep the haircut, so versions can share a close-up: only the
// ones no remaining version uses can go.
export function orphanHairKeys(removed: AvatarVersion[], kept: AvatarVersion[]) {
  const inUse = new Set(kept.map((version) => version.hair?.refKey).filter(Boolean))

  return [
    ...new Set(
      removed
        .map((version) => version.hair?.refKey)
        .filter((key): key is string => Boolean(key) && !inUse.has(key as string)),
    ),
  ]
}
