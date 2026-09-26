import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import type { ColorAnalysis } from '../../types/mongo.js'
import { errorMessage } from '../../utils/http.js'
import { toStoredWebp } from '../../utils/images.js'
import {
  createStructuredResponse,
  generateImageFromReferences,
  toDataUrl,
} from '../../utils/openai.js'
import { storage } from '../../utils/storage.js'
import { releaseGenerations } from '../../utils/usage.js'
import {
  COLOR_ANALYSIS_INSTRUCTIONS,
  buildAvatarPrompt,
  colorAnalysisSchema,
} from './prompts.js'

const HEX_PATTERN = /^#[0-9a-f]{6}$/i

function cleanSwatches(swatches: ColorAnalysis['bestColors'], max: number) {
  return swatches
    .filter((swatch) => swatch.name.trim() && HEX_PATTERN.test(swatch.hex))
    .slice(0, max)
    .map((swatch) => ({ name: swatch.name.trim(), hex: swatch.hex.toUpperCase() }))
}

export async function analyzeColors(selfie: Buffer): Promise<ColorAnalysis> {
  const analysis = await createStructuredResponse<ColorAnalysis>({
    instructions: COLOR_ANALYSIS_INSTRUCTIONS,
    content: [
      {
        type: 'input_text',
        text: 'Analyze this selfie and return the color profile.',
      },
      { type: 'input_image', image_url: toDataUrl(selfie, 'image/jpeg'), detail: 'high' },
    ],
    schemaName: 'color_analysis',
    schema: colorAnalysisSchema,
  })

  return {
    ...analysis,
    bestColors: cleanSwatches(analysis.bestColors, 12),
    neutrals: cleanSwatches(analysis.neutrals, 6),
    avoidColors: cleanSwatches(analysis.avoidColors, 5),
  }
}

// Runs the avatar pipeline for one avatar document. The color read and the
// full-body render run in parallel; whatever succeeds is kept, so a retry only
// redoes the missing part.
export async function runAvatarJob(
  app: FastifyInstance,
  avatarId: ObjectId,
  options: { render: boolean; analyze: boolean },
) {
  const avatar = await app.collections.avatars.findOne({ _id: avatarId })

  if (!avatar) {
    return
  }

  const selfie = await storage.read(avatar.selfieKey)
  const [analysisResult, renderResult] = await Promise.allSettled([
    options.analyze ? analyzeColors(selfie) : Promise.resolve(avatar.colorAnalysis),
    options.render
      ? generateImageFromReferences({
          images: [{ data: selfie, filename: 'selfie.jpg', contentType: 'image/jpeg' }],
          prompt: buildAvatarPrompt(avatar.body),
        })
      : Promise.resolve(null),
  ])

  const update: Record<string, unknown> = { updatedAt: new Date() }
  const failures: string[] = []
  let oldAvatarKey: string | null = null

  if (analysisResult.status === 'fulfilled') {
    update.colorAnalysis = analysisResult.value
  } else {
    failures.push(`color analysis: ${errorMessage(analysisResult.reason)}`)
  }

  if (renderResult.status === 'fulfilled' && renderResult.value) {
    const key = `users/${avatar.userId.toString()}/avatar-${Date.now()}.webp`
    await storage.put(key, await toStoredWebp(renderResult.value), 'image/webp')
    oldAvatarKey = avatar.avatarKey
    update.avatarKey = key
  } else if (renderResult.status === 'rejected') {
    failures.push(`render: ${errorMessage(renderResult.reason)}`)
  }

  if (failures.length > 0) {
    app.log.error({ avatarId: avatarId.toString(), failures }, 'Avatar job failed')
    update.status = 'failed'
    update.error = 'We could not finish your avatar. Please try again.'
    await releaseGenerations(app, avatar.userId, 'avatar', 1)
  } else {
    update.status = 'ready'
    update.error = null
    update.readyAt = new Date()
  }

  await app.collections.avatars.updateOne({ _id: avatarId }, { $set: update })

  if (oldAvatarKey) {
    await storage.remove(oldAvatarKey).catch(() => undefined)
  }
}

export function startAvatarJob(
  app: FastifyInstance,
  avatarId: ObjectId,
  options: { render: boolean; analyze: boolean },
) {
  void runAvatarJob(app, avatarId, options).catch(async (error: unknown) => {
    app.log.error({ err: error, avatarId: avatarId.toString() }, 'Avatar job crashed')

    try {
      const avatar = await app.collections.avatars.findOneAndUpdate(
        { _id: avatarId, status: 'processing' },
        {
          $set: {
            status: 'failed',
            error: 'We could not finish your avatar. Please try again.',
            updatedAt: new Date(),
          },
        },
      )

      if (avatar) {
        await releaseGenerations(app, avatar.userId, 'avatar', 1)
      }
    } catch {
      // Stale-job recovery on the next boot will catch it.
    }
  })
}
