import { readFile } from 'node:fs/promises'

import type { FastifyPluginAsync } from 'fastify'

import { env } from '../../config/env.js'
import {
  isValidStorageKey,
  localPathFor,
  verifyLocalMediaSignature,
} from '../../utils/storage.js'

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

// Serves files from the local storage driver behind short-lived HMAC
// signatures. With STORAGE_DRIVER=s3 the URLs point at S3 and this route is
// not registered.
const mediaRoutes: FastifyPluginAsync = async (app) => {
  app.get('/*', async (request, reply) => {
    const key = (request.params as { '*': string })['*']
    const query = request.query as { exp?: string; sig?: string }
    const exp = Number(query.exp)

    if (
      env.STORAGE_DRIVER !== 'local' ||
      !isValidStorageKey(key) ||
      !query.sig ||
      !verifyLocalMediaSignature(key, exp, query.sig)
    ) {
      return reply.code(404).send({ message: 'Not found.' })
    }

    try {
      const file = await readFile(localPathFor(key))
      const extension = key.split('.').pop()?.toLowerCase() ?? ''

      return reply
        .header('Content-Type', CONTENT_TYPES[extension] ?? 'application/octet-stream')
        .header('Cache-Control', 'private, max-age=3600')
        .header('Cross-Origin-Resource-Policy', 'cross-origin')
        .send(file)
    } catch {
      return reply.code(404).send({ message: 'Not found.' })
    }
  })
}

export default mediaRoutes
