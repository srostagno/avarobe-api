import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'

import type { AvatarDocument, LookDocument, LookItem, LookPlan, ScoreCheckDocument } from '../../types/mongo.js'
import { createStructuredResponse, toDataUrl } from '../../utils/openai.js'
import { buildTryOnRequest, tryOnAnalysisSchema } from '../looks/prompts.js'
import { cleanItem, startLookRender } from '../looks/service.js'

// "See it fixed" (Look Score, Pro): her outfit from the photo with its tips
// applied, drawn on her avatar. Not an upload try-on (that copies the photo's
// garments exactly): the stylist reads her outfit, keeps what works, changes
// what the tips say, and the look is drawn from that plan alone.

const FIX_INSTRUCTIONS = [
  'You are Avarobe, a senior personal stylist.',
  'The photo shows the client herself wearing an outfit she had rated. You get the changes her stylist recommended.',
  'Write the corrected outfit, head to toe: keep every garment that works exactly as it is (real color, fabric and cut), and apply each recommended change (swap, add or adjust the pieces it names). Mark kept pieces fromPhoto true and changed or added pieces fromPhoto false.',
  'Keep her style and the occasion the outfit suggests; change only what the recommendations call for, plus the fewest pieces needed so the outfit works.',
  'Never mention weight or body flaws. Use generic garment names, never brand names.',
  'Write in warm, concise American English, second person.',
].join(' ')

type FixAnalysis = Omit<LookPlan, 'items'> & { hasOutfit: boolean; dressCode: string; items: (LookItem & { fromPhoto: boolean })[] }

export class NothingToFixError extends Error {}

export async function planFix(avatar: AvatarDocument, photo: Buffer, tips: string[]) {
  const response = await createStructuredResponse<FixAnalysis>({
    instructions: FIX_INSTRUCTIONS,
    content: [
      {
        type: 'input_text',
        text: `${buildTryOnRequest(avatar, null)}\n\nThe recommended changes:\n${tips.map((tip) => `- ${tip}`).join('\n')}`,
      },
      { type: 'input_image', image_url: toDataUrl(photo, 'image/jpeg'), detail: 'high' },
    ],
    schemaName: 'score_fix',
    schema: tryOnAnalysisSchema,
    timeoutMs: 120_000,
  })

  if (!response.hasOutfit || response.items.length === 0) {
    throw new NothingToFixError('No outfit to fix.')
  }

  const plan: LookPlan = {
    title: response.title.trim(),
    vibe: response.vibe,
    summary: response.summary.trim(),
    whyItWorks: response.whyItWorks.trim(),
    items: response.items.slice(0, 8).map((item) => ({ ...cleanItem(item), fromPhoto: item.fromPhoto })),
    stylingTips: response.stylingTips.slice(0, 3),
  }

  return { dressCode: response.dressCode.trim(), plan }
}

// The look, from the plan (no reference photo), linked from the score. The
// caller reserved the look allowance and spent the credit; a failed render
// gives both back (looks/service.ts markLookFailed).
export async function startFixLook(
  app: FastifyInstance,
  input: { check: ScoreCheckDocument; avatar: AvatarDocument; plan: LookPlan; dressCode: string; creditSpent: boolean },
) {
  const now = new Date()
  const look: LookDocument = {
    _id: new ObjectId(),
    userId: input.check.userId,
    avatarId: input.avatar._id,
    batchId: new ObjectId(),
    occasion: { text: 'Look Score', dressCode: input.dressCode, summary: input.plan.summary },
    plan: input.plan,
    source: 'stylist',
    status: 'processing',
    error: null,
    imageKey: null,
    creditSpent: input.creditSpent,
    collectionIds: [],
    favorite: false,
    createdAt: now,
    updatedAt: now,
    readyAt: null,
  }

  await app.collections.looks.insertOne(look)
  await app.collections.scoreChecks.updateOne({ _id: input.check._id }, { $set: { fixLookId: look._id, updatedAt: now } })
  startLookRender(app, look._id)

  return look
}
