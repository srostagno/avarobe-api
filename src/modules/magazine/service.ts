import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'
import sharp from 'sharp'

import { env } from '../../config/env.js'
import type { AvatarDocument, MagazineDocument, MagazinePhoto, MagazinePlan, MagazineShot } from '../../types/mongo.js'
import { deliverEmail } from '../../utils/email.js'
import { errorMessage } from '../../utils/http.js'
import { createStructuredResponse, generateImageFromReferences, type ImageInput } from '../../utils/openai.js'
import { signedUrlOrNull, storage } from '../../utils/storage.js'
import { trackServerEvent } from '../analytics/service.js'
import { magazineReadyEmail } from '../lifecycle/templates.js'
import { MAGAZINE_INSTRUCTIONS, buildMagazinePhotoPrompt, buildMagazineRequest, magazineSchema } from './prompts.js'

// Photos made at once for one magazine.
const CONCURRENCY = 4

export function magazineSeason(avatar: Pick<AvatarDocument, 'colorAnalysis'>) {
  return avatar.colorAnalysis ? `The ${avatar.colorAnalysis.season} Issue` : 'The Fall Issue'
}

export async function planMagazine(input: {
  firstName: string
  avatar: Pick<AvatarDocument, 'body' | 'presentation' | 'colorAnalysis' | 'styleProfile'>
  moments: string[]
}) {
  return createStructuredResponse<MagazinePlan>({
    instructions: MAGAZINE_INSTRUCTIONS,
    content: [{ type: 'input_text', text: buildMagazineRequest({ ...input, season: magazineSeason(input.avatar) }) }],
    schemaName: 'personal_magazine',
    schema: magazineSchema(input.moments.length),
    reasoningEffort: 'low',
    timeoutMs: 150_000,
  })
}

const photoKey = (magazine: Pick<MagazineDocument, '_id' | 'userId'>, name: string) =>
  `users/${magazine.userId.toString()}/magazine-${magazine._id.toString()}-${name}-${Date.now()}.webp`

// The cover is taller, with open background above the head for the masthead.
async function photo(references: ImageInput[], shot: MagazineShot, cover = false) {
  return generateImageFromReferences({
    images: references,
    prompt: buildMagazinePhotoPrompt(shot, { cover }),
    size: cover ? '1024x1824' : '1024x1536',
    model: env.MAGAZINE_IMAGE_MODEL,
    quality: env.MAGAZINE_IMAGE_QUALITY,
  })
}

async function setPhoto(app: FastifyInstance, magazineId: ObjectId, field: string, value: MagazinePhoto) {
  await app.collections.magazines.updateOne({ _id: magazineId }, { $set: { [field]: value, updatedAt: new Date() } })
}

// Makes every photo still missing (all of them the first time, the failed
// ones on a retry), then marks the issue ready and emails them.
export async function runMagazine(app: FastifyInstance, magazineId: ObjectId) {
  const magazine = await app.collections.magazines.findOne({ _id: magazineId })

  if (!magazine?.plan) {
    return
  }

  const avatar = await app.collections.avatars.findOne({ userId: magazine.userId }, { projection: { avatarKey: 1, selfieKey: 1 } })

  if (!avatar?.avatarKey) {
    await app.collections.magazines.updateOne({ _id: magazineId }, { $set: { status: 'failed', updatedAt: new Date() } })
    return
  }

  const [avatarImage, selfie] = await Promise.all([storage.read(avatar.avatarKey), storage.read(avatar.selfieKey)])
  const references: ImageInput[] = [
    { data: avatarImage, filename: 'avatar.webp', contentType: 'image/webp' },
    { data: selfie, filename: 'face.jpg', contentType: 'image/jpeg' },
  ]
  const plan = magazine.plan
  const jobs: (() => Promise<void>)[] = []

  if (magazine.cover.status !== 'ready') {
    jobs.push(async () => {
      try {
        const cover = await photo(references, plan.cover, true)
        const key = photoKey(magazine, 'cover')
        await storage.put(key, await sharp(cover).webp({ quality: 88 }).toBuffer(), 'image/webp')
        await setPhoto(app, magazineId, 'cover', { status: 'ready', key })
      } catch (error) {
        app.log.error({ err: errorMessage(error), magazineId: magazineId.toString() }, 'Magazine cover failed')
        await setPhoto(app, magazineId, 'cover', { status: 'failed', key: null })
      }
    })
  }

  plan.looks.forEach((look, index) => {
    if (magazine.looks[index]?.status === 'ready') {
      return
    }

    jobs.push(async () => {
      try {
        const png = await photo(references, look)
        const key = photoKey(magazine, `look-${index}`)
        await storage.put(key, await sharp(png).webp({ quality: 88 }).toBuffer(), 'image/webp')
        await setPhoto(app, magazineId, `looks.${index}`, { status: 'ready', key })
      } catch (error) {
        app.log.error({ err: errorMessage(error), magazineId: magazineId.toString(), index }, 'Magazine look failed')
        await setPhoto(app, magazineId, `looks.${index}`, { status: 'failed', key: null })
      }
    })
  })

  const queue = [...jobs]
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) await queue.shift()!()
    }),
  )

  const done = await app.collections.magazines.findOne({ _id: magazineId })

  if (!done) {
    return
  }

  const photos = [done.cover, ...done.looks]
  const ready = photos.filter((p) => p.status === 'ready').length
  // Ready with a cover and most looks; a few failed looks can be redone.
  const status = done.cover.status === 'ready' && ready >= photos.length - 2 ? 'ready' : 'failed'
  const firstReady = status === 'ready' && !done.readyAt

  await app.collections.magazines.updateOne(
    { _id: magazineId },
    { $set: { status, updatedAt: new Date(), ...(firstReady ? { readyAt: new Date() } : {}) } },
  )

  void trackServerEvent(app, { name: status === 'ready' ? 'magazine_ready' : 'magazine_failed', userId: done.userId, props: { photos: photos.length, ready } })

  if (firstReady) {
    const user = await app.collections.users.findOne({ _id: done.userId }, { projection: { email: 1, firstName: 1 } })

    if (user?.email) {
      await deliverEmail({
        log: app.log,
        to: { email: user.email, name: user.firstName ?? undefined },
        content: magazineReadyEmail({ email: user.email, firstName: user.firstName ?? '', url: `${env.APP_URL}/studio/magazine/${done._id.toString()}` }),
      }).catch((error: unknown) => app.log.error({ err: errorMessage(error) }, 'Magazine email failed'))
    }
  }
}

export function startMagazine(app: FastifyInstance, magazineId: ObjectId) {
  void runMagazine(app, magazineId).catch((error: unknown) => {
    app.log.error({ err: errorMessage(error), magazineId: magazineId.toString() }, 'Magazine failed')
    void app.collections.magazines.updateOne({ _id: magazineId }, { $set: { status: 'failed', updatedAt: new Date() } }).catch(() => undefined)
  })
}

export async function serializeMagazine(magazine: MagazineDocument) {
  const url = (p: MagazinePhoto | undefined) => (p?.status === 'ready' ? signedUrlOrNull(p.key) : Promise.resolve(null))

  return {
    id: magazine._id.toString(),
    status: magazine.status,
    season: magazine.season,
    palette: magazine.palette,
    moments: magazine.moments,
    plan: magazine.plan,
    cover: { status: magazine.cover.status, url: await url(magazine.cover) },
    looks: await Promise.all(magazine.looks.map(async (p) => ({ status: p.status, url: await url(p) }))),
    createdAt: magazine.createdAt.toISOString(),
    readyAt: magazine.readyAt?.toISOString() ?? null,
  }
}
