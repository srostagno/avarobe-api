import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { ObjectId } from 'mongodb'
import { ObjectId as MongoObjectId } from 'mongodb'
import { z } from 'zod'

import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import type { CollectionDocument } from '../../types/mongo.js'
import { parseBody } from '../../utils/http.js'
import { toObjectId } from '../../utils/object-id.js'
import { serializeCollection, serializeLook } from '../../utils/serializers.js'

const MAX_COLLECTIONS = 50

const nameSchema = z.object({
  name: z.string().trim().min(1).max(60),
})

const addLookSchema = z.object({
  lookId: z.string(),
})

async function summarize(app: FastifyInstance, collection: CollectionDocument) {
  const [lookCount, covers] = await Promise.all([
    app.collections.looks.countDocuments({
      userId: collection.userId,
      collectionIds: collection._id,
    }),
    app.collections.looks
      .find(
        {
          userId: collection.userId,
          collectionIds: collection._id,
          imageKey: { $ne: null },
        },
        { projection: { imageKey: 1 } },
      )
      .sort({ createdAt: -1 })
      .limit(4)
      .toArray(),
  ])

  return serializeCollection(collection, {
    lookCount,
    coverKeys: covers
      .map((look) => look.imageKey)
      .filter((key): key is string => Boolean(key)),
  })
}

async function findOwned(app: FastifyInstance, userId: ObjectId, rawId: unknown) {
  const collectionId = toObjectId(rawId)

  return collectionId
    ? app.collections.collections.findOne({ _id: collectionId, userId })
    : null
}

const collectionRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request) => {
    const userId = requireUserId(request)
    const collections = await app.collections.collections
      .find({ userId })
      .sort({ updatedAt: -1 })
      .toArray()

    return {
      collections: await Promise.all(collections.map((item) => summarize(app, item))),
    }
  })

  app.post('/', async (request, reply) => {
    const userId = requireUserId(request)
    const parsed = parseBody(nameSchema, request.body)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    if ((await app.collections.collections.countDocuments({ userId })) >= MAX_COLLECTIONS) {
      return reply
        .code(409)
        .send({ message: `You can have up to ${MAX_COLLECTIONS} collections.` })
    }

    const now = new Date()
    const collection: CollectionDocument = {
      _id: new MongoObjectId(),
      userId,
      name: parsed.data.name,
      createdAt: now,
      updatedAt: now,
    }

    await app.collections.collections.insertOne(collection)

    return reply.code(201).send({ collection: await summarize(app, collection) })
  })

  app.get('/:id', async (request, reply) => {
    const userId = requireUserId(request)
    const collection = await findOwned(app, userId, (request.params as { id?: string }).id)

    if (!collection) {
      return reply.code(404).send({ message: 'Collection not found.' })
    }

    const looks = await app.collections.looks
      .find({ userId, collectionIds: collection._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray()

    return {
      collection: await summarize(app, collection),
      looks: await Promise.all(looks.map(serializeLook)),
    }
  })

  app.patch('/:id', async (request, reply) => {
    const userId = requireUserId(request)
    const parsed = parseBody(nameSchema, request.body)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const collectionId = toObjectId((request.params as { id?: string }).id)
    const collection = collectionId
      ? await app.collections.collections.findOneAndUpdate(
          { _id: collectionId, userId },
          { $set: { name: parsed.data.name, updatedAt: new Date() } },
          { returnDocument: 'after' },
        )
      : null

    if (!collection) {
      return reply.code(404).send({ message: 'Collection not found.' })
    }

    return { collection: await summarize(app, collection) }
  })

  // Deleting a collection keeps its looks; they just leave the collection.
  app.delete('/:id', async (request, reply) => {
    const userId = requireUserId(request)
    const collection = await findOwned(app, userId, (request.params as { id?: string }).id)

    if (!collection) {
      return reply.code(404).send({ message: 'Collection not found.' })
    }

    await app.collections.collections.deleteOne({ _id: collection._id })
    await app.collections.looks.updateMany(
      { userId, collectionIds: collection._id },
      { $pull: { collectionIds: collection._id } },
    )

    return { ok: true }
  })

  app.post('/:id/looks', async (request, reply) => {
    const userId = requireUserId(request)
    const parsed = parseBody(addLookSchema, request.body)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const collection = await findOwned(app, userId, (request.params as { id?: string }).id)
    const lookId = toObjectId(parsed.data.lookId)

    if (!collection || !lookId) {
      return reply.code(404).send({ message: 'Collection or look not found.' })
    }

    const look = await app.collections.looks.findOneAndUpdate(
      { _id: lookId, userId },
      { $addToSet: { collectionIds: collection._id }, $set: { updatedAt: new Date() } },
      { returnDocument: 'after' },
    )

    if (!look) {
      return reply.code(404).send({ message: 'Look not found.' })
    }

    await app.collections.collections.updateOne(
      { _id: collection._id },
      { $set: { updatedAt: new Date() } },
    )

    return { look: await serializeLook(look) }
  })

  app.delete('/:id/looks/:lookId', async (request, reply) => {
    const userId = requireUserId(request)
    const params = request.params as { id?: string; lookId?: string }
    const collection = await findOwned(app, userId, params.id)
    const lookId = toObjectId(params.lookId)

    if (!collection || !lookId) {
      return reply.code(404).send({ message: 'Collection or look not found.' })
    }

    const look = await app.collections.looks.findOneAndUpdate(
      { _id: lookId, userId },
      { $pull: { collectionIds: collection._id }, $set: { updatedAt: new Date() } },
      { returnDocument: 'after' },
    )

    if (!look) {
      return reply.code(404).send({ message: 'Look not found.' })
    }

    return { look: await serializeLook(look) }
  })
}

export default collectionRoutes
