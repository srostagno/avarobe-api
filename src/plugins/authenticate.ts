import type { FastifyReply, FastifyRequest } from 'fastify'

import { ACCESS_TOKEN_COOKIE } from '../constants/auth.js'
import { toObjectId } from '../utils/object-id.js'
import { extractBearerToken } from '../utils/tokens.js'

type AccessTokenPayload = {
  sub: string
  email: string
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const token =
    extractBearerToken(request.headers.authorization) ??
    request.cookies[ACCESS_TOKEN_COOKIE]

  if (!token) {
    return reply.code(401).send({ message: 'Unauthorized' })
  }

  try {
    const payload = await request.server.jwt.verify<AccessTokenPayload>(token)
    const userId = toObjectId(payload.sub)

    if (!userId) {
      return reply.code(401).send({ message: 'Unauthorized' })
    }

    const user = await request.server.collections.users.findOne(
      { _id: userId },
      { projection: { _id: 1 } },
    )

    if (!user) {
      return reply.code(401).send({ message: 'Unauthorized' })
    }

    request.authUserId = payload.sub
  } catch {
    return reply.code(401).send({ message: 'Unauthorized' })
  }
}

export function requireUserId(request: FastifyRequest) {
  const userId = toObjectId(request.authUserId)

  if (!userId) {
    throw new Error('requireUserId called on an unauthenticated request.')
  }

  return userId
}
