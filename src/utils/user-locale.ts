import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import type { Locale } from './locale.js'

// The language an account uses (English when it was never set).
export async function userLocale(app: FastifyInstance, userId: ObjectId): Promise<Locale> {
  const user = await app.collections.users.findOne({ _id: userId }, { projection: { locale: 1 } })
  return user?.locale ?? 'en'
}
