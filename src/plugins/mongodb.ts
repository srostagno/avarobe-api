import type { Collection, Db, MongoClient } from 'mongodb'
import { MongoClient as MongoDriverClient } from 'mongodb'
import fp from 'fastify-plugin'

import { env } from '../config/env.js'
import type {
  ArrivalDocument,
  AuthChallengeDocument,
  AvatarDocument,
  CollectionDocument,
  EmailSendDocument,
  LookDocument,
  PasskeyDocument,
  PurchaseDocument,
  RefreshTokenDocument,
  ShopSearchDocument,
  TasteDocument,
  UsageCounterDocument,
  UserDocument,
} from '../types/mongo.js'

export type MongoCollections = {
  users: Collection<UserDocument>
  refreshTokens: Collection<RefreshTokenDocument>
  avatars: Collection<AvatarDocument>
  looks: Collection<LookDocument>
  collections: Collection<CollectionDocument>
  tastes: Collection<TasteDocument>
  usageCounters: Collection<UsageCounterDocument>
  passkeys: Collection<PasskeyDocument>
  authChallenges: Collection<AuthChallengeDocument>
  shopSearches: Collection<ShopSearchDocument>
  purchases: Collection<PurchaseDocument>
  emailSends: Collection<EmailSendDocument>
  arrivals: Collection<ArrivalDocument>
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
    tastes: mongoDb.collection<TasteDocument>('tastes'),
    usageCounters: mongoDb.collection<UsageCounterDocument>('usage_counters'),
    passkeys: mongoDb.collection<PasskeyDocument>('passkeys'),
    authChallenges: mongoDb.collection<AuthChallengeDocument>('auth_challenges'),
    shopSearches: mongoDb.collection<ShopSearchDocument>('shop_searches'),
    purchases: mongoDb.collection<PurchaseDocument>('purchases'),
    emailSends: mongoDb.collection<EmailSendDocument>('email_sends'),
    arrivals: mongoDb.collection<ArrivalDocument>('arrivals'),
  }
}

async function ensureMongoIndexes(collections: MongoCollections) {
  await Promise.all([
    collections.users.createIndex({ email: 1 }, { unique: true }),
    // Onboarding emails look at recent sign-ups.
    collections.users.createIndex({ createdAt: -1 }),
    collections.refreshTokens.createIndex({ tokenHash: 1 }, { unique: true }),
    collections.refreshTokens.createIndex({ userId: 1 }),
    collections.refreshTokens.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0 },
    ),
    collections.avatars.createIndex({ userId: 1 }, { unique: true }),
    collections.avatars.createIndex({ status: 1, updatedAt: 1 }),
    collections.avatars.createIndex({ createdAt: -1 }),
    collections.looks.createIndex({ userId: 1, createdAt: -1 }),
    collections.looks.createIndex({ userId: 1, batchId: 1 }),
    collections.looks.createIndex({ userId: 1, collectionIds: 1, createdAt: -1 }),
    collections.looks.createIndex({ status: 1, updatedAt: 1 }),
    collections.looks.createIndex({ createdAt: -1 }),
    collections.looks.createIndex(
      { userId: 1, 'feedback.at': -1 },
      { partialFilterExpression: { 'feedback.at': { $exists: true } } },
    ),
    collections.looks.createIndex({ userId: 1, remixOf: 1 }, { partialFilterExpression: { remixOf: { $exists: true } } }),
    collections.tastes.createIndex({ userId: 1 }, { unique: true }),
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
    collections.shopSearches.createIndex(
      { userId: 1, lookId: 1, pieceId: 1, market: 1 },
      { unique: true },
    ),
    collections.shopSearches.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0 },
    ),
    collections.purchases.createIndex({ stripeSessionId: 1 }, { unique: true }),
    collections.purchases.createIndex({ userId: 1, createdAt: -1 }),
    collections.purchases.createIndex({ createdAt: -1 }),
    collections.emailSends.createIndex({ userId: 1, sentAt: -1 }),
    collections.emailSends.createIndex({ sentAt: -1 }),
    collections.arrivals.createIndex(
      { click: 1, stage: 1 },
      { unique: true, partialFilterExpression: { click: { $type: 'string' } } },
    ),
    collections.arrivals.createIndex({ at: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 }),
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
