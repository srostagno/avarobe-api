import type { FastifyPluginAsync } from 'fastify'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import type { TasteNote } from '../../types/mongo.js'
import { parseBody } from '../../utils/http.js'
import { MAX_TASTE_NOTES, ensureTaste, readTaste, scheduleTasteLearning, serializeTaste } from './service.js'

const statementSchema = z.object({
  statement: z.string().trim().max(400).nullable(),
})

const noteSchema = z.object({
  list: z.enum(['loves', 'avoids']),
  text: z.string().trim().min(2).max(80),
})

const MAX_DISMISSED = 60
const normalize = (text: string) => text.trim().toLowerCase()

// What the stylist knows about the person's taste: their own words and
// lines, plus what it learned from their feedback. Every line can be removed.
const tasteRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request) => {
    const userId = requireUserId(request)

    return { taste: serializeTaste(await readTaste(app, userId)) }
  })

  app.patch('/', async (request, reply) => {
    const userId = requireUserId(request)
    const parsed = parseBody(statementSchema, request.body)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const taste = await ensureTaste(app, userId)

    await app.collections.tastes.updateOne(
      { _id: taste._id },
      { $set: { statement: parsed.data.statement || null, updatedAt: new Date() } },
    )
    await scheduleTasteLearning(app, userId)

    return { taste: serializeTaste(await readTaste(app, userId)) }
  })

  app.post('/notes', async (request, reply) => {
    const userId = requireUserId(request)
    const parsed = parseBody(noteSchema, request.body)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const { list, text } = parsed.data
    const taste = await ensureTaste(app, userId)
    const key = normalize(text)
    const other = list === 'loves' ? 'avoids' : 'loves'

    if (taste[list].filter((note) => note.source === 'you').length >= MAX_TASTE_NOTES) {
      return reply.code(400).send({ message: `Keep it to ${MAX_TASTE_NOTES} lines; remove one first.` })
    }

    const note: TasteNote = { id: new ObjectId().toString(), text, source: 'you', evidence: 0 }
    // The person's line replaces a learned one saying the same, and wins over
    // the opposite list ("love boots" moves out of avoids).
    await app.collections.tastes.updateOne(
      { _id: taste._id },
      {
        $set: {
          [list]: [note, ...taste[list].filter((entry) => normalize(entry.text) !== key)],
          [other]: taste[other].filter((entry) => normalize(entry.text) !== key),
          dismissed: taste.dismissed.filter((entry) => normalize(entry) !== key),
          updatedAt: new Date(),
        },
      },
    )
    await scheduleTasteLearning(app, userId)

    return { taste: serializeTaste(await readTaste(app, userId)) }
  })

  app.delete('/notes/:id', async (request, reply) => {
    const userId = requireUserId(request)
    const noteId = (request.params as { id?: string }).id
    const taste = await readTaste(app, userId)
    const note = taste && [...taste.loves, ...taste.avoids].find((entry) => entry.id === noteId)

    if (!taste || !note) {
      return reply.code(404).send({ message: 'That line is already gone.' })
    }

    await app.collections.tastes.updateOne(
      { _id: taste._id },
      {
        $set: {
          loves: taste.loves.filter((entry) => entry.id !== noteId),
          avoids: taste.avoids.filter((entry) => entry.id !== noteId),
          // Learning must not bring back a line the person took out.
          dismissed:
            note.source === 'learned' ? [note.text, ...taste.dismissed].slice(0, MAX_DISMISSED) : taste.dismissed,
          updatedAt: new Date(),
        },
      },
    )

    return { taste: serializeTaste(await readTaste(app, userId)) }
  })
}

export default tasteRoutes
