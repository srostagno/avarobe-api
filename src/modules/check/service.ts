import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import type { ColorCheckDocument } from '../../types/mongo.js'
import { errorMessage } from '../../utils/http.js'
import { toStoredWebp } from '../../utils/images.js'
import { createStructuredResponse, generateImageFromReferences, toDataUrl } from '../../utils/openai.js'
import { signedUrlOrNull, storage } from '../../utils/storage.js'
import { PaywallError, billingState, loadBillingUser } from '../billing/entitlements.js'

import { CHECK_SCHEMA, type CheckReading, buildCheckInstructions, buildCheckRenderPrompt } from './prompts.js'

// How many checks each plan includes: one to try it, five with the Color
// Report, and Pro (or the admins' free access) as many as the daily cap.
const FREE_CHECKS = 1
const REPORT_CHECKS = 5
export const DAILY_CHECKS = 10

// The daily cap: not an offer, just "come back tomorrow".
export class CheckLimitError extends Error {}

// Whether they can run one more check now; throws the offer that unlocks
// more when they can't.
export async function assertCheckAllowed(app: FastifyInstance, userId: ObjectId) {
  const user = await loadBillingUser(app, userId)
  const state = user ? billingState(user) : null
  const counted = { userId, status: { $ne: 'failed' as const } }
  const today = await app.collections.colorChecks.countDocuments({ ...counted, createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } })

  if (today >= DAILY_CHECKS) {
    throw new CheckLimitError(`That's ${DAILY_CHECKS} checks today. More tomorrow.`)
  }

  if (state?.proActive) {
    return
  }

  const used = await app.collections.colorChecks.countDocuments(counted)

  if (state?.colorReport && used < REPORT_CHECKS) {
    return
  }

  if (!state?.colorReport && used < FREE_CHECKS) {
    return
  }

  throw state?.colorReport
    ? new PaywallError('needs_pro', 'More color checks come with Avarobe Pro.')
    : new PaywallError('needs_color_report', 'More color checks come with your Color Report.')
}

// Reads the garment against their colors, then draws that color next to
// their face. The reading lands first, so the page can show it while the
// picture draws.
export async function runCheck(app: FastifyInstance, checkId: ObjectId) {
  const check = await app.collections.colorChecks.findOne({ _id: checkId })
  const avatar = check ? await app.collections.avatars.findOne({ userId: check.userId }) : null
  const fail = (error: string) =>
    app.collections.colorChecks.updateOne({ _id: checkId }, { $set: { status: 'failed', error, updatedAt: new Date() } })

  if (!check || !avatar?.colorAnalysis) {
    await fail('We need your colors first: send a selfie.')
    return
  }

  try {
    const garment = await storage.read(check.garmentKey)
    const reading = await createStructuredResponse<CheckReading>({
      instructions: buildCheckInstructions(avatar.colorAnalysis),
      content: [
        { type: 'input_text', text: 'Read this garment against my colors.' },
        { type: 'input_image', image_url: toDataUrl(garment, 'image/jpeg'), detail: 'high' },
      ],
      schemaName: 'color_check',
      schema: CHECK_SCHEMA,
      reasoningEffort: 'low',
    })

    await app.collections.colorChecks.updateOne({ _id: checkId }, { $set: { reading, updatedAt: new Date() } })

    if (reading.verdict === 'unclear') {
      await app.collections.colorChecks.updateOne({ _id: checkId }, { $set: { status: 'ready', updatedAt: new Date() } })
      return
    }

    const png = await generateImageFromReferences({
      images: [{ data: await storage.read(avatar.selfieKey), filename: 'selfie.jpg', contentType: 'image/jpeg' }],
      prompt: buildCheckRenderPrompt(reading.color),
      size: '1024x1024',
    })
    const imageKey = `users/${check.userId.toString()}/check-${checkId.toString()}-${Date.now()}.webp`

    await storage.put(imageKey, await toStoredWebp(png), 'image/webp')

    const saved = await app.collections.colorChecks.updateOne(
      { _id: checkId },
      { $set: { status: 'ready', imageKey, updatedAt: new Date() } },
    )

    if (saved.matchedCount === 0) {
      await storage.remove(imageKey).catch(() => undefined)
    }
  } catch (error) {
    app.log.error({ checkId: checkId.toString(), err: errorMessage(error) }, 'Color check failed')
    await fail('We could not read that photo. Try a clearer one of the garment.')
  }
}

export function startCheck(app: FastifyInstance, checkId: ObjectId) {
  void runCheck(app, checkId).catch((error: unknown) => {
    app.log.error({ err: error, checkId: checkId.toString() }, 'Color check crashed')
  })
}

export async function serializeCheck(check: ColorCheckDocument) {
  return {
    id: check._id.toString(),
    status: check.status,
    error: check.error,
    garmentUrl: await signedUrlOrNull(check.garmentKey),
    imageUrl: await signedUrlOrNull(check.imageKey),
    reading: check.reading,
    createdAt: check.createdAt.toISOString(),
  }
}

// Every file a check owns, for deleting it with the account.
export function checkStorageKeys(check: Pick<ColorCheckDocument, 'garmentKey' | 'imageKey'>) {
  return [check.garmentKey, check.imageKey].filter((key): key is string => Boolean(key))
}
