import type { Db, MongoClient } from 'mongodb'

import type { MongoCollections } from '../plugins/mongodb.js'

declare module 'fastify' {
  interface FastifyInstance {
    mongoClient: MongoClient
    mongoDb: Db
    collections: MongoCollections
  }

  interface FastifyRequest {
    authUserId?: string
  }
}
