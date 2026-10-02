import type { ObjectId } from 'mongodb'

import type { LookDocument } from '../../types/mongo.js'
import type { RemixHistoryEntry } from './prompts.js'

// How far back a remix reads the looks it came from.
export const REMIX_HISTORY_DEPTH = 8

type HistoryLook = Pick<LookDocument, 'plan' | 'occasion' | 'feedback' | 'remix' | 'remixOf'>

// The looks this one was remixed from for the same occasion, oldest first,
// with what the person said about each: their feedback, and what they asked
// for when they had it remixed ("custom"). A fix reads all of it, so a chain
// of fixes never forgets what they asked for two fixes ago.
export async function remixHistory(
  look: HistoryLook,
  findLook: (id: ObjectId) => Promise<HistoryLook | null>,
): Promise<RemixHistoryEntry[]> {
  const history: RemixHistoryEntry[] = []
  let current = look

  for (let depth = 0; depth < REMIX_HISTORY_DEPTH && current.remixOf; depth += 1) {
    const parent = await findLook(current.remixOf)

    // A remix for another occasion starts a new brief.
    if (!parent || parent.occasion.text !== look.occasion.text || current.remix?.change === 'occasion') {
      break
    }

    history.unshift({
      plan: parent.plan,
      feedback: parent.feedback ?? null,
      asked: parent.remix?.change === 'custom' ? parent.remix.detail : null,
    })
    current = parent
  }

  return history
}
