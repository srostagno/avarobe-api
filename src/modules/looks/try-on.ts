import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ObjectId } from 'mongodb'

import type { AvatarDocument, LookDocument } from '../../types/mongo.js'
import { errorMessage } from '../../utils/http.js'
import { serializeLook } from '../../utils/serializers.js'
import { storage } from '../../utils/storage.js'
import { releaseGenerations } from '../../utils/usage.js'
import { PaywallError, refundCredits, requireKit, sendPaywall, spendCredits } from '../billing/entitlements.js'
import type { IconLook } from './icons.js'
import { reserveLookQuota } from './quota.js'
import { NoOutfitError, analyzeOutfit, startLookRender } from './service.js'

// The try-on flow once the outfit photo is in hand (an upload or an icon
// look): quota, Kit and credit, the stylist's read of the photo, then the
// render in the background. Every failure gives the credit back.
export async function startTryOn(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  input: { userId: ObjectId; avatar: AvatarDocument; photo: Buffer; notes: string | null; icon?: IconLook },
) {
  const { userId, avatar, photo, notes, icon } = input
  const quota = await reserveLookQuota(app, userId, 1)

  if (!quota.ok) {
    return reply.code(quota.status).send(quota.body)
  }

  let creditSpent: boolean

  try {
    await requireKit(app, userId, 'Trying on outfits')
    creditSpent = await spendCredits(app, userId, 1)
  } catch (error) {
    await releaseGenerations(app, userId, 'look', 1)

    if (error instanceof PaywallError) {
      return sendPaywall(reply, error)
    }

    throw error
  }

  const refund = async () => {
    await releaseGenerations(app, userId, 'look', 1)
    await refundCredits(app, userId, creditSpent ? 1 : 0)
  }
  let analysis: Awaited<ReturnType<typeof analyzeOutfit>>

  try {
    analysis = await analyzeOutfit({ avatar, photo, notes })
  } catch (error) {
    await refund()

    if (error instanceof NoOutfitError) {
      return reply
        .code(422)
        .send({ message: "We couldn't find an outfit in that photo. Try one that shows the clothes clearly." })
    }

    request.log.error({ err: errorMessage(error), iconId: icon?.id }, 'Try-on analysis failed')
    return reply.code(502).send({ message: 'Our stylist could not read that photo. Please try again.' })
  }

  const now = new Date()
  const lookId = new ObjectId()
  // Icon looks get a copy under the person's prefix too, so deleting the look
  // or the account removes it like any uploaded photo.
  const referenceKey = `users/${userId.toString()}/look-${lookId.toString()}-reference.jpg`
  const look: LookDocument = {
    _id: lookId,
    userId,
    avatarId: avatar._id,
    batchId: new ObjectId(),
    occasion: {
      text: notes ?? 'Try-on',
      dressCode: analysis.dressCode,
      summary: analysis.plan.summary,
    },
    // Icon looks keep the catalog's name and exact pieces; the stylist's read
    // of the image brings the notes for this person's palette and body.
    plan: icon
      ? { ...analysis.plan, title: icon.name, items: icon.items.map((item) => ({ ...item, fromPhoto: true })) }
      : analysis.plan,
    source: 'tryon',
    ...(icon ? { iconId: icon.id } : {}),
    referenceKey,
    status: 'processing',
    error: null,
    imageKey: null,
    creditSpent,
    collectionIds: [],
    favorite: false,
    createdAt: now,
    updatedAt: now,
    readyAt: null,
  }

  try {
    await storage.put(referenceKey, photo, 'image/jpeg')
    await app.collections.looks.insertOne(look)
  } catch (error) {
    await storage.remove(referenceKey).catch(() => undefined)
    await refund()
    throw error
  }

  startLookRender(app, look._id)

  return reply.code(202).send({ look: await serializeLook(look) })
}
