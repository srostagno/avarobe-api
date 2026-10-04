import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import Fastify from 'fastify'

import { env } from './config/env.js'
import adminReportRoutes from './modules/admin/reports.js'
import adminRoutes from './modules/admin/routes.js'
import analyticsRoutes from './modules/analytics/routes.js'
import passkeyRoutes from './modules/auth/passkeys.js'
import authRoutes from './modules/auth/routes.js'
import avatarRoutes from './modules/avatar/routes.js'
import billingRoutes, { billingWebhookRoutes } from './modules/billing/routes.js'
import reportRoutes from './modules/report/routes.js'
import tasteRoutes from './modules/taste/routes.js'
import collectionRoutes from './modules/collections/routes.js'
import eventRoutes from './modules/events/routes.js'
import styleEventRoutes from './modules/style-events/routes.js'
import magazineRoutes from './modules/magazine/routes.js'
import guideRoutes from './modules/guide/routes.js'
import hairRoutes from './modules/hair/routes.js'
import checkRoutes from './modules/check/routes.js'
import healthRoutes from './modules/health/routes.js'
import iconLookRoutes from './modules/looks/icon-routes.js'
import lookRoutes from './modules/looks/routes.js'
import lifecycleRoutes from './modules/lifecycle/routes.js'
import mediaRoutes from './modules/media/routes.js'
import meRoutes from './modules/me/routes.js'
import mongodbPlugin from './plugins/mongodb.js'

function isLoopbackOrigin(origin: string) {
  try {
    const { hostname } = new URL(origin)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

function isAllowedCorsOrigin(origin: string) {
  if (env.CORS_ORIGINS.includes(origin)) {
    return true
  }

  return env.NODE_ENV === 'development' && isLoopbackOrigin(origin)
}

type BuildAppOptions = {
  ensureMongoIndexes?: boolean
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: true,
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  })

  await app.register(cookie)

  await app.register(cors, {
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, false)
      }

      // Reflect the validated origin to keep credentials-compatible CORS.
      return callback(null, isAllowedCorsOrigin(origin) ? origin : false)
    },
  })

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
  })

  await app.register(jwt, { secret: env.JWT_ACCESS_SECRET })
  await app.register(multipart)
  await app.register(mongodbPlugin, { ensureIndexes: options.ensureMongoIndexes })

  await app.register(async (v1) => {
    await v1.register(healthRoutes, { prefix: '/health' })
    await v1.register(authRoutes, { prefix: '/auth' })
    await v1.register(passkeyRoutes, { prefix: '/auth/passkeys' })
    await v1.register(meRoutes, { prefix: '/me' })
    await v1.register(avatarRoutes, { prefix: '/avatar' })
    await v1.register(lookRoutes, { prefix: '/looks' })
    await v1.register(iconLookRoutes, { prefix: '/looks/icons' })
    await v1.register(collectionRoutes, { prefix: '/collections' })
    await v1.register(billingRoutes, { prefix: '/billing' })
    await v1.register(reportRoutes, { prefix: '/report' })
    await v1.register(tasteRoutes, { prefix: '/taste' })
    await v1.register(hairRoutes, { prefix: '/hair' })
    await v1.register(checkRoutes, { prefix: '/check' })
    await v1.register(styleEventRoutes, { prefix: '/style-events' })
    await v1.register(magazineRoutes, { prefix: '/magazines' })
    await v1.register(guideRoutes, { prefix: '/guide' })
    await v1.register(lifecycleRoutes, { prefix: '/email' })
    await v1.register(adminRoutes, { prefix: '/admin' })
    await v1.register(adminReportRoutes, { prefix: '/admin/reports' })
    await v1.register(eventRoutes, { prefix: '/events' })
    await v1.register(analyticsRoutes, { prefix: '/analytics' })
    await v1.register(billingWebhookRoutes, { prefix: '/billing/webhook' })

    if (env.STORAGE_DRIVER === 'local') {
      await v1.register(mediaRoutes, { prefix: '/media' })
    }
  }, { prefix: '/api/v1' })

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ message: 'Route not found.' })
  })

  app.setErrorHandler((error, request, reply) => {
    const statusCode =
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500

    if (statusCode < 500) {
      return reply.code(statusCode).send({ message: (error as Error).message })
    }

    request.log.error({ err: error }, 'Unhandled request error')

    if (!reply.sent) {
      return reply.code(500).send({ message: 'Internal server error.' })
    }
  })

  return app
}
