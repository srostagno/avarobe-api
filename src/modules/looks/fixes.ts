import type { LookDocument } from '../../types/mongo.js'

// Fixing a look that missed is on us: the first fix of each look rated
// down costs no look. A fix can miss too, so its own first fix is free as
// well, up to this many in a row from the original look; after that a fix
// costs a look like any other.
export const FREE_FIXES_IN_A_ROW = 3

export function fixIsFree(look: Pick<LookDocument, 'status' | 'feedback' | 'freeFixAt' | 'freeFixes'>) {
  return (
    look.status === 'ready' &&
    look.feedback?.rating === 'down' &&
    !look.freeFixAt &&
    (look.freeFixes ?? 0) < FREE_FIXES_IN_A_ROW
  )
}
