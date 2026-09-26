import type { CookieSerializeOptions } from '@fastify/cookie'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ObjectId } from 'mongodb'

import { env } from '../config/env.js'
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '../constants/auth.js'
import { durationToSeconds, generateSecureToken, hashToken } from './tokens.js'

export const ACCESS_TOKEN_MAX_AGE = durationToSeconds(env.ACCESS_TOKEN_TTL)
export const REFRESH_TOKEN_MAX_AGE = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60

export function baseCookieOptions(): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    domain: env.COOKIE_DOMAIN,
    path: '/',
  }
}

export function getClientMeta(request: FastifyRequest) {
  const userAgent = request.headers['user-agent']

  return {
    ip: request.ip ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : null,
  }
}

async function setSessionCookies(
  app: FastifyInstance,
  reply: FastifyReply,
  user: { id: string; email: string },
  refreshToken: string,
) {
  const accessToken = await app.jwt.sign(
    { sub: user.id, email: user.email },
    { expiresIn: env.ACCESS_TOKEN_TTL },
  )
  const options = baseCookieOptions()

  reply.setCookie(ACCESS_TOKEN_COOKIE, accessToken, {
    ...options,
    maxAge: ACCESS_TOKEN_MAX_AGE,
  })
  reply.setCookie(REFRESH_TOKEN_COOKIE, refreshToken, {
    ...options,
    maxAge: REFRESH_TOKEN_MAX_AGE,
  })
}

export async function issueAuthSession(
  app: FastifyInstance,
  reply: FastifyReply,
  request: FastifyRequest,
  user: { id: string; email: string },
) {
  const refreshToken = generateSecureToken()
  const clientMeta = getClientMeta(request)

  await app.collections.refreshTokens.insertOne({
    _id: new ObjectId(),
    tokenHash: hashToken(refreshToken),
    userId: new ObjectId(user.id),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_MAX_AGE * 1000),
    revokedAt: null,
    replacedByTokenHash: null,
    createdAt: new Date(),
    createdByIp: clientMeta.ip,
    userAgent: clientMeta.userAgent,
  })

  await setSessionCookies(app, reply, user, refreshToken)
}

// Rotates the refresh token: the presented one is revoked and a new pair is
// issued. Returns null when the token is unknown, expired or already used.
export async function rotateAuthSession(
  app: FastifyInstance,
  reply: FastifyReply,
  request: FastifyRequest,
  presentedToken: string,
) {
  const storedToken = await app.collections.refreshTokens.findOne({
    tokenHash: hashToken(presentedToken),
  })

  if (
    !storedToken ||
    storedToken.revokedAt ||
    storedToken.expiresAt.getTime() <= Date.now()
  ) {
    return null
  }

  const user = await app.collections.users.findOne({ _id: storedToken.userId })

  if (!user) {
    return null
  }

  const newRefreshToken = generateSecureToken()
  const newRefreshTokenHash = hashToken(newRefreshToken)
  const now = new Date()
  const revokeResult = await app.collections.refreshTokens.updateOne(
    { _id: storedToken._id, revokedAt: null },
    { $set: { revokedAt: now, replacedByTokenHash: newRefreshTokenHash } },
  )

  if (revokeResult.modifiedCount !== 1) {
    return null
  }

  const clientMeta = getClientMeta(request)

  await app.collections.refreshTokens.insertOne({
    _id: new ObjectId(),
    tokenHash: newRefreshTokenHash,
    userId: storedToken.userId,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_MAX_AGE * 1000),
    revokedAt: null,
    replacedByTokenHash: null,
    createdAt: now,
    createdByIp: clientMeta.ip,
    userAgent: clientMeta.userAgent,
  })

  await setSessionCookies(
    app,
    reply,
    { id: user._id.toString(), email: user.email },
    newRefreshToken,
  )

  return user
}

export function clearAuthCookies(reply: FastifyReply) {
  const options: CookieSerializeOptions = {
    ...baseCookieOptions(),
    maxAge: 0,
    expires: new Date(0),
  }

  reply.setCookie(ACCESS_TOKEN_COOKIE, '', options)
  reply.setCookie(REFRESH_TOKEN_COOKIE, '', options)
}
