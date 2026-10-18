import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'

import type { AvatarDocument, HairstyleDocument, ScoreCheckDocument } from '../../types/mongo.js'
import { signedUrlOrNull } from '../../utils/storage.js'
import { NotAHaircutError, planHairRequest, startHairstyleRender } from '../hair/service.js'

// "Unlock your perfect haircut" (Hair Score, Pro; Oct 17, 2026, Silvio: "it
// should recommend me a haircut and send me the image"): the stylist plans
// the cut that fits her, from what her read said holds her hair back (her
// ideal cut from the Hair studio when she has one), and it's drawn on her as
// a haircut of her own (Hair studio: onto her avatar, the salon brief).

export class NoPerfectCutError extends Error {}

function describe(check: ScoreCheckDocument, ideal: string | null) {
  const tips = (check.reading?.tips ?? []).map((tip) => tip.text)

  return [
    'The haircut that would flatter this person most, fixing what holds their hair back today.',
    ideal ? `Their stylist's ideal cut for them: ${ideal}.` : null,
    tips.length ? `What their hair needs: ${tips.join(' ')}` : null,
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 900)
}

// The caller reserved today's 'hair' allowance and spent the credit; a
// failed render gives both back (hair/service markHairstyleFailed).
export async function startPerfectHaircut(app: FastifyInstance, input: { check: ScoreCheckDocument; avatar: AvatarDocument; creditSpent: boolean }) {
  const ideal = input.avatar.hairProfile?.data?.recommendations[0] ?? null
  let plan: Awaited<ReturnType<typeof planHairRequest>>

  try {
    plan = await planHairRequest({ avatar: input.avatar, description: describe(input.check, ideal ? `${ideal.name}: ${ideal.render}` : null), photo: null })
  } catch (error) {
    if (error instanceof NotAHaircutError && ideal) {
      plan = { name: ideal.name, render: ideal.render, stylistBrief: ideal.stylistBrief, fit: { verdict: 'great', note: ideal.why } }
    } else if (error instanceof NotAHaircutError) {
      throw new NoPerfectCutError('No haircut to suggest.')
    } else {
      throw error
    }
  }

  const now = new Date()
  const hairstyle: HairstyleDocument = {
    _id: new ObjectId(),
    userId: input.check.userId,
    avatarId: input.avatar._id,
    source: 'described',
    recommendationId: null,
    name: plan.name,
    why: null,
    stylistBrief: plan.stylistBrief,
    fit: plan.fit,
    render: plan.render,
    request: 'Hair Score',
    referenceKey: null,
    status: 'processing',
    error: null,
    imageKey: null,
    previewKey: null,
    creditSpent: input.creditSpent,
    freeRun: false,
    createdAt: now,
    updatedAt: now,
    readyAt: null,
  }

  await app.collections.hairstyles.insertOne(hairstyle)
  await app.collections.scoreChecks.updateOne({ _id: input.check._id }, { $set: { perfectHairstyleId: hairstyle._id, updatedAt: now } })
  startHairstyleRender(app, hairstyle._id)

  return hairstyle
}

export async function serializePerfect(hairstyle: HairstyleDocument | null) {
  if (!hairstyle) {
    return null
  }

  const [imageUrl, previewUrl] = await Promise.all([signedUrlOrNull(hairstyle.imageKey), signedUrlOrNull(hairstyle.previewKey)])

  return {
    id: hairstyle._id.toString(),
    name: hairstyle.name,
    status: hairstyle.status,
    error: hairstyle.error,
    stylistBrief: hairstyle.stylistBrief,
    imageUrl,
    previewUrl,
  }
}
