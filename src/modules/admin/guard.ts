import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ObjectId } from 'mongodb'

import { requireUserId } from '../../plugins/authenticate.js'
import { isAdmin } from '../billing/entitlements.js'

// The admin pages' guard, after `authenticate`: the signed-in account must be
// an admin (COMP_EMAILS). Anyone else gets a 403 and null.
export async function adminViewer(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply): Promise<{ id: ObjectId; email: string } | null> {
  const viewerId = requireUserId(request)
  const viewer = await app.collections.users.findOne({ _id: viewerId }, { projection: { email: 1 } })

  if (!viewer || !isAdmin(viewer)) {
    await reply.code(403).send({ message: 'Only admins can do this.' })
    return null
  }

  return { id: viewerId, email: viewer.email }
}

export async function viewerIfAdmin(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply) {
  return (await adminViewer(app, request, reply))?.id ?? null
}
