import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import type { AvatarDocument, LookItem, LookPlan } from '../../types/mongo.js'
import { errorMessage } from '../../utils/http.js'
import { toStoredWebp } from '../../utils/images.js'
import {
  createStructuredResponse,
  generateImageFromReferences,
} from '../../utils/openai.js'
import { storage } from '../../utils/storage.js'
import { releaseGenerations } from '../../utils/usage.js'
import {
  LOOK_PLAN_INSTRUCTIONS,
  buildLookPlanRequest,
  buildLookRenderPrompt,
  lookPlanSchema,
} from './prompts.js'

const HEX_PATTERN = /^#[0-9a-f]{6}$/i
const RENDER_FAILED_MESSAGE = 'We could not render this look. Try again.'

type LookPlanResponse = {
  dressCode: string
  occasionSummary: string
  looks: LookPlan[]
}

function cleanItem(item: LookItem): LookItem {
  return {
    ...item,
    name: item.name.trim(),
    color: item.color.trim(),
    colorHex: HEX_PATTERN.test(item.colorHex) ? item.colorHex.toUpperCase() : '#9A948C',
    material: item.material.trim(),
    fit: item.fit.trim(),
  }
}

export async function planLooks(input: {
  avatar: AvatarDocument
  occasion: string
  notes: string | null
  count: number
}) {
  const response = await createStructuredResponse<LookPlanResponse>({
    instructions: LOOK_PLAN_INSTRUCTIONS,
    content: [{ type: 'input_text', text: buildLookPlanRequest(input) }],
    schemaName: 'look_plan',
    schema: lookPlanSchema,
    timeoutMs: 120_000,
  })

  const looks = response.looks
    .filter((look) => look.items.length > 0)
    .slice(0, input.count)
    .map((look) => ({
      ...look,
      title: look.title.trim(),
      items: look.items.slice(0, 8).map(cleanItem),
      stylingTips: look.stylingTips.slice(0, 3),
    }))

  if (looks.length === 0) {
    throw new Error('The stylist returned no looks.')
  }

  return {
    dressCode: response.dressCode.trim(),
    occasionSummary: response.occasionSummary.trim(),
    looks,
  }
}

async function markLookFailed(app: FastifyInstance, lookId: ObjectId) {
  const look = await app.collections.looks.findOneAndUpdate(
    { _id: lookId, status: 'processing' },
    { $set: { status: 'failed', error: RENDER_FAILED_MESSAGE, updatedAt: new Date() } },
  )

  if (look) {
    await releaseGenerations(app, look.userId, 'look', 1)
  }
}

export async function runLookRender(app: FastifyInstance, lookId: ObjectId) {
  const look = await app.collections.looks.findOne({ _id: lookId })

  if (!look) {
    return
  }

  const avatar = await app.collections.avatars.findOne({ _id: look.avatarId })

  if (!avatar?.avatarKey) {
    await markLookFailed(app, lookId)
    return
  }

  const [avatarImage, selfie] = await Promise.all([
    storage.read(avatar.avatarKey),
    storage.read(avatar.selfieKey),
  ])

  try {
    const png = await generateImageFromReferences({
      images: [
        { data: avatarImage, filename: 'avatar.webp', contentType: 'image/webp' },
        { data: selfie, filename: 'face.jpg', contentType: 'image/jpeg' },
      ],
      prompt: buildLookRenderPrompt(look.plan, look.occasion.text),
    })
    const key = `users/${look.userId.toString()}/look-${look._id.toString()}-${Date.now()}.webp`

    await storage.put(key, await toStoredWebp(png), 'image/webp')

    const now = new Date()
    const result = await app.collections.looks.updateOne(
      { _id: lookId },
      { $set: { status: 'ready', error: null, imageKey: key, updatedAt: now, readyAt: now } },
    )

    // The look was deleted while rendering.
    if (result.matchedCount === 0) {
      await storage.remove(key).catch(() => undefined)
    }
  } catch (error) {
    app.log.error({ lookId: lookId.toString(), err: errorMessage(error) }, 'Look render failed')
    await markLookFailed(app, lookId)
  }
}

export function startLookRender(app: FastifyInstance, lookId: ObjectId) {
  void runLookRender(app, lookId).catch(async (error: unknown) => {
    app.log.error({ err: error, lookId: lookId.toString() }, 'Look render crashed')
    await markLookFailed(app, lookId).catch(() => undefined)
  })
}
