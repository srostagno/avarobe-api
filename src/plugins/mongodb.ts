import type { Collection, Db, MongoClient } from 'mongodb'
import { MongoClient as MongoDriverClient } from 'mongodb'
import fp from 'fastify-plugin'

import { env } from '../config/env.js'
import type {
  AnalyticsEventDocument,
  ArrivalDocument,
  AuthChallengeDocument,
  AvatarDocument,
  CollectionDocument,
  ColorCheckDocument,
  FaceCheckDocument,
  EmailSendDocument,
  HairstyleDocument,
  LookDocument,
  PasskeyDocument,
  PurchaseDocument,
  RefreshTokenDocument,
  RefundRequestDocument,
  ShopSearchDocument,
  StyleEventDocument,
  MagazineDocument,
  GuideOrderDocument,
  OpsAlertDocument,
  SurveyAnswerDocument,
  FeedbackDocument,
  TasteDocument,
  UsageCounterDocument,
  UserDocument,
} from '../types/mongo.js'

export type MongoCollections = {
  users: Collection<UserDocument>
  refreshTokens: Collection<RefreshTokenDocument>
  avatars: Collection<AvatarDocument>
  looks: Collection<LookDocument>
  hairstyles: Collection<HairstyleDocument>
  collections: Collection<CollectionDocument>
  surveyAnswers: Collection<SurveyAnswerDocument>
  feedback: Collection<FeedbackDocument>
  colorChecks: Collection<ColorCheckDocument>
  faceChecks: Collection<FaceCheckDocument>
  tastes: Collection<TasteDocument>
  usageCounters: Collection<UsageCounterDocument>
  passkeys: Collection<PasskeyDocument>
  authChallenges: Collection<AuthChallengeDocument>
  shopSearches: Collection<ShopSearchDocument>
  purchases: Collection<PurchaseDocument>
  emailSends: Collection<EmailSendDocument>
  arrivals: Collection<ArrivalDocument>
  analyticsEvents: Collection<AnalyticsEventDocument>
  styleEvents: Collection<StyleEventDocument>
  magazines: Collection<MagazineDocument>
  guideOrders: Collection<GuideOrderDocument>
  opsAlerts: Collection<OpsAlertDocument>
  refundRequests: Collection<RefundRequestDocument>
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
    hairstyles: mongoDb.collection<HairstyleDocument>('hairstyles'),
    collections: mongoDb.collection<CollectionDocument>('collections'),
    surveyAnswers: mongoDb.collection<SurveyAnswerDocument>('survey_answers'),
    feedback: mongoDb.collection<FeedbackDocument>('feedback'),
    colorChecks: mongoDb.collection<ColorCheckDocument>('color_checks'),
    faceChecks: mongoDb.collection<FaceCheckDocument>('face_checks'),
    tastes: mongoDb.collection<TasteDocument>('tastes'),
    usageCounters: mongoDb.collection<UsageCounterDocument>('usage_counters'),
    passkeys: mongoDb.collection<PasskeyDocument>('passkeys'),
    authChallenges: mongoDb.collection<AuthChallengeDocument>('auth_challenges'),
    shopSearches: mongoDb.collection<ShopSearchDocument>('shop_searches'),
    purchases: mongoDb.collection<PurchaseDocument>('purchases'),
    emailSends: mongoDb.collection<EmailSendDocument>('email_sends'),
    arrivals: mongoDb.collection<ArrivalDocument>('arrivals'),
    analyticsEvents: mongoDb.collection<AnalyticsEventDocument>('analytics_events'),
    styleEvents: mongoDb.collection<StyleEventDocument>('style_events'),
    magazines: mongoDb.collection<MagazineDocument>('magazines'),
    guideOrders: mongoDb.collection<GuideOrderDocument>('guide_orders'),
    opsAlerts: mongoDb.collection<OpsAlertDocument>('ops_alerts'),
    refundRequests: mongoDb.collection<RefundRequestDocument>('refund_requests'),
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
    // Color reads waiting to be tried again for a "tell me when ready".
    collections.avatars.createIndex(
      { 'colorsNotify.requestedAt': 1 },
      { partialFilterExpression: { 'colorsNotify.requestedAt': { $exists: true } } },
    ),
    collections.looks.createIndex({ userId: 1, createdAt: -1 }),
    collections.styleEvents.createIndex({ userId: 1, createdAt: -1 }),
    collections.magazines.createIndex({ userId: 1, createdAt: -1 }),
    collections.guideOrders.createIndex({ sessionId: 1 }, { unique: true }),
    collections.guideOrders.createIndex({ token: 1 }, { unique: true }),
    collections.guideOrders.createIndex({ refundToken: 1 }, { unique: true, partialFilterExpression: { refundToken: { $type: 'string' } } }),
    collections.looks.createIndex({ eventId: 1 }, { sparse: true }),
    collections.looks.createIndex({ userId: 1, batchId: 1 }),
    collections.looks.createIndex({ userId: 1, collectionIds: 1, createdAt: -1 }),
    collections.looks.createIndex({ status: 1, updatedAt: 1 }),
    collections.looks.createIndex({ createdAt: -1 }),
    collections.looks.createIndex(
      { userId: 1, 'feedback.at': -1 },
      { partialFilterExpression: { 'feedback.at': { $exists: true } } },
    ),
    collections.looks.createIndex({ userId: 1, remixOf: 1 }, { partialFilterExpression: { remixOf: { $exists: true } } }),
    collections.hairstyles.createIndex({ userId: 1, createdAt: -1 }),
    collections.hairstyles.createIndex({ status: 1, updatedAt: 1 }),
    collections.tastes.createIndex({ userId: 1 }, { unique: true }),
    collections.collections.createIndex({ userId: 1, createdAt: -1 }),
    collections.surveyAnswers.createIndex({ userId: 1, question: 1, createdAt: -1 }),
    collections.surveyAnswers.createIndex({ createdAt: -1 }),
    collections.feedback.createIndex({ userId: 1, product: 1 }, { unique: true }),
    collections.feedback.createIndex({ createdAt: -1 }),
    collections.colorChecks.createIndex({ userId: 1, createdAt: -1 }),
    // Face Age: her timeline by the photo's date, and the day's count.
    collections.faceChecks.createIndex({ userId: 1, takenAt: -1 }),
    collections.faceChecks.createIndex({ userId: 1, createdAt: -1 }),
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
    // First-party analytics: kept 400 days, read by time, by event and by person.
    collections.analyticsEvents.createIndex({ at: 1 }, { expireAfterSeconds: 400 * 24 * 60 * 60 }),
    collections.analyticsEvents.createIndex({ name: 1, at: 1 }),
    collections.analyticsEvents.createIndex({ visitorId: 1, at: 1 }),
    collections.analyticsEvents.createIndex({ userId: 1, at: 1 }),
    // Refund requests (billing/refund-requests.ts): one open request per
    // purchase, Pro week or book order; the admin's queue; each person's
    // history and limits; the Stripe refund webhook's lookups; abuse checks.
    collections.refundRequests.createIndex({ openKey: 1 }, { unique: true, partialFilterExpression: { openKey: { $type: 'string' } } }),
    collections.refundRequests.createIndex({ ref: 1 }, { unique: true }),
    collections.refundRequests.createIndex({ status: 1, createdAt: -1 }),
    collections.refundRequests.createIndex({ userId: 1, createdAt: -1 }),
    collections.refundRequests.createIndex({ targetKey: 1 }),
    collections.refundRequests.createIndex({ purchaseId: 1 }),
    collections.refundRequests.createIndex({ guideOrderId: 1 }),
    collections.refundRequests.createIndex({ 'covers.stripePaymentIntentId': 1 }),
    collections.refundRequests.createIndex({ emailHash: 1 }),
    collections.refundRequests.createIndex(
      { 'market.card.fingerprint': 1 },
      { partialFilterExpression: { 'market.card.fingerprint': { $type: 'string' } } },
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
