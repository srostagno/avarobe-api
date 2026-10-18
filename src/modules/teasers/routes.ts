import type { FastifyPluginAsync } from 'fastify'

import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import { toObjectId } from '../../utils/object-id.js'
import { PaywallError, requirePro, sendPaywall } from '../billing/entitlements.js'
import { serializeTeaser, unlockTeaser } from './service.js'

// Her teasers (modules/teasers/service.ts): what's drawn for her, blurred
// until Pro; unlocking one with Pro makes it hers at once.
const teaserRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request) => {
    const userId = requireUserId(request)
    const teasers = await app.collections.teasers.find({ userId, status: { $ne: 'failed' } }).sort({ createdAt: -1 }).limit(20).toArray()

    return { teasers: await Promise.all(teasers.map(serializeTeaser)) }
  })

  app.post('/:id/unlock', { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (request, reply) => {
    const userId = requireUserId(request)
    const id = toObjectId((request.params as { id: string }).id)
    const teaser = id ? await app.collections.teasers.findOne({ _id: id, userId }) : null

    if (!teaser || teaser.status === 'failed') {
      return reply.code(404).send({ message: 'Not found.' })
    }

    try {
      await requirePro(app, userId, 'Unlocking it')
    } catch (error) {
      if (error instanceof PaywallError) {
        return sendPaywall(reply, error)
      }

      throw error
    }

    await unlockTeaser(app, teaser)
    const fresh = await app.collections.teasers.findOne({ _id: teaser._id })

    return reply.code(fresh?.resultId ? 200 : 202).send({ teaser: await serializeTeaser(fresh) })
  })
}

export default teaserRoutes
