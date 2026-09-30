import type { AvatarBody, AvatarDocument } from '../../types/mongo.js'

// Anything drawn on, or written for, the avatar needs the body. Someone who
// came for their colors has none until they make the avatar; the routes
// send them there first, so reaching this without one is a bug.
export function bodyOf(avatar: Pick<AvatarDocument, 'body'>): AvatarBody {
  if (!avatar.body) {
    throw new Error('This needs the avatar (and its measurements) first.')
  }

  return avatar.body
}
