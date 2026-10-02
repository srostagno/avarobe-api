import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import type { EventPrep, StyleEventDocument } from '../../types/mongo.js'
import { errorMessage } from '../../utils/http.js'
import { createStructuredResponse } from '../../utils/openai.js'
import { serializeLook } from '../../utils/serializers.js'
import { EVENT_PREP_INSTRUCTIONS, buildEventPrepRequest, eventPrepSchema } from './prompts.js'

// How to finish an event's looks: hair, makeup or grooming, accessories and
// a checklist. Written once the looks are planned; text only.
export async function runEventPrep(app: FastifyInstance, eventId: ObjectId) {
  const event = await app.collections.styleEvents.findOne({ _id: eventId })

  if (!event) {
    return
  }

  const [avatar, looks] = await Promise.all([
    app.collections.avatars.findOne({ userId: event.userId }, { projection: { body: 1, colorAnalysis: 1, hairProfile: 1 } }),
    app.collections.looks.find({ eventId }, { projection: { plan: 1 } }).sort({ createdAt: 1 }).toArray(),
  ])

  if (!avatar) {
    return
  }

  const data = await createStructuredResponse<EventPrep>({
    instructions: EVENT_PREP_INSTRUCTIONS,
    content: [
      {
        type: 'input_text',
        text: buildEventPrepRequest({ avatar, occasion: event.occasion, dressCode: event.dressCode, date: event.date, looks }),
      },
    ],
    schemaName: 'event_prep',
    schema: eventPrepSchema,
    reasoningEffort: 'low',
  })

  await app.collections.styleEvents.updateOne(
    { _id: eventId },
    { $set: { prep: { status: 'ready', data }, updatedAt: new Date() } },
  )
}

export function startEventPrep(app: FastifyInstance, eventId: ObjectId) {
  void runEventPrep(app, eventId).catch((error: unknown) => {
    app.log.error({ err: errorMessage(error), eventId: eventId.toString() }, 'Event prep failed')
    void app.collections.styleEvents
      .updateOne({ _id: eventId }, { $set: { 'prep.status': 'failed', updatedAt: new Date() } })
      .catch(() => undefined)
  })
}

export async function serializeStyleEvent(app: FastifyInstance, event: StyleEventDocument, options: { looks: boolean }) {
  const looks = await app.collections.looks.find({ eventId: event._id, userId: event.userId }).sort({ createdAt: 1 }).toArray()

  return {
    id: event._id.toString(),
    occasion: event.occasion,
    date: event.date,
    budget: event.budget,
    notes: event.notes,
    dressCode: event.dressCode,
    summary: event.summary,
    prep: event.prep,
    createdAt: event.createdAt.toISOString(),
    cover: (await Promise.all(looks.slice(0, 3).map(serializeLook))).map((look) => look.imageUrl ?? look.previewUrl),
    looks: options.looks ? await Promise.all(looks.map(serializeLook)) : [],
  }
}
