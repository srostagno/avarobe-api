import type { Collection, Db, MongoClient } from 'mongodb'
import { MongoClient as MongoDriverClient } from 'mongodb'
import fp from 'fastify-plugin'

import { env } from '../config/env.js'
import type {
  AuthChallengeDocument,
  AvatarDocument,
  CollectionDocument,
  LookDocument,
  PasskeyDocument,
  RefreshTokenDocument,
  UsageCounterDocument,
  UserDocument,
} from '../types/mongo.js'

export type MongoCollections = {
  users: Collection<UserDocument>
  refreshTokens: Collection<RefreshTokenDocument>
  avatars: Collection<AvatarDocument>
  looks: Collection<LookDocument>
  collections: Collection<CollectionDocument>
  usageCounters: Collection<UsageCounterDocument>
  passkeys: Collection<PasskeyDocument>
  authChallenges: Collection<AuthChallengeDocument>
}

export type MongodbPluginOptions = {
  ensureIndexes?: boolean
}

export function buildCollections(mongoDb: Db): MongoCollections {
  return {
    users: mongoDb.collection<UserDocument>('users'),
    refreshTokens: mongoDb.collection<RefreshTokenDocument>('refresh_tokens'),
    avatars: mongoDb.collection<AvatarDocument>('avatars'),
    looks: mongoDb.collection<LookDocument>('looks'),
    collections: mongoDb.collection<CollectionDocument>('collections'),
    usageCounters: mongoDb.collection<UsageCounterDocument>('usage_counters'),
    passkeys: mongoDb.collection<PasskeyDocument>('passkeys'),
    authChallenges: mongoDb.collection<AuthChallengeDocument>('auth_challenges'),
  }
}

async function ensureMongoIndexes(collections: MongoCollections) {
  await Promise.all([
    collections.users.createIndex({ email: 1 }, { unique: true }),
    collections.refreshTokens.createIndex({ tokenHash: 1 }, { unique: true }),
    collections.refreshTokens.createIndex({ userId: 1 }),
    collections.refreshTokens.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0 },
    ),
    collections.avatars.createIndex({ userId: 1 }, { unique: true }),
    collections.avatars.createIndex({ status: 1, updatedAt: 1 }),
    collections.looks.createIndex({ userId: 1, createdAt: -1 }),
    collections.looks.createIndex({ userId: 1, batchId: 1 }),
    collections.looks.createIndex({ userId: 1, collectionIds: 1, createdAt: -1 }),
    collections.looks.createIndex({ status: 1, updatedAt: 1 }),
    collections.collections.createIndex({ userId: 1, createdAt: -1 }),
    collections.usageCounters.createIndex(
      { expireAt: 1 },
      { expireAfterSeconds: 0 },
    ),
    collections.passkeys.createIndex({ credentialId: 1 }, { unique: true }),
    collections.passkeys.createIndex({ userId: 1 }),
    collections.authChallenges.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0 },
    ),
  ])
}

export async function connectMongo(): Promise<{
  mongoClient: MongoClient
  mongoDb: Db
}> {
  const mongoClient = new MongoDriverClient(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 15_000,
    connectTimeoutMS: 15_000,
  })

  await mongoClient.connect()

  return { mongoClient, mongoDb: mongoClient.db(env.MONGODB_DB) }
}

export default fp<MongodbPluginOptions>(async (app, options) => {
  const { mongoClient, mongoDb } = await connectMongo()
  const collections = buildCollections(mongoDb)

  if (options.ensureIndexes !== false) {
    await ensureMongoIndexes(collections)
  }

  app.decorate('mongoClient', mongoClient)
  app.decorate('mongoDb', mongoDb)
  app.decorate('collections', collections)

  app.addHook('onClose', async () => {
    await mongoClient.close()
  })
}, { name: 'mongodb' })
