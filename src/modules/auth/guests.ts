import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ObjectId } from 'mongodb'

import { env } from '../../config/env.js'
import type { Acquisition, UserDocument } from '../../types/mongo.js'
import { guestEmail } from '../../utils/guests.js'
import { type Locale, requestLocale } from '../../utils/locale.js'
import { isDuplicateKeyError } from '../../utils/mongo-errors.js'
import { signupLocation } from '../analytics/geo.js'
import { toAcquisition, trackServerEvent } from '../analytics/service.js'
import { deleteUserContent } from '../me/content.js'

// Trying Avarobe before an account (Oct 2026). 74% of visitors left at the
// sign-up form (Oct 1–7) and the emails it collected sold nothing, so the
// selfie and colors now come first: a guest is a normal account without an
// email, signed in with the usual cookies, so every studio route works for
// it unchanged. The email comes when they buy or save ("claim"), with no
// password; they sign back in with an emailed link or a passkey.

const DAY_MS = 24 * 60 * 60 * 1000

export class GuestLimitError extends Error {}

export async function createGuest(app: FastifyInstance, request: FastifyRequest, acquisition: Parameters<typeof toAcquisition>[0]) {
  const now = new Date()
  const startedToday = await app.collections.users.countDocuments({
    guest: true,
    createdAt: { $gte: new Date(now.getTime() - DAY_MS) },
  })

  // Each guest's selfie is an AI read we pay for: a ceiling on a bad day.
  if (startedToday >= env.GUEST_DAILY_LIMIT) {
    throw new GuestLimitError('guest limit')
  }

  const _id = new ObjectId()
  const user: UserDocument = {
    _id,
    email: guestEmail(_id),
    firstName: '',
    credits: env.SIGNUP_CREDITS,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
    emailVerifiedAt: null,
    // No address to send tips to; cleared when they save with their email.
    emailTipsOptOutAt: now,
    guest: true,
    locale: requestLocale(request),
    acquisition: toAcquisition(acquisition),
    location: signupLocation(request, now),
  }

  await app.collections.users.insertOne(user)
  void trackServerEvent(app, { name: 'guest_started', userId: _id, props: {} })

  return user
}

export type ClaimResult = { ok: true; user: UserDocument } | { ok: false; reason: 'not_guest' | 'email_taken' }

// Puts their email (and a password, when they signed up with one) on the
// guest account they've been using, so nothing they made is lost.
export async function claimGuest(
  app: FastifyInstance,
  guestId: ObjectId,
  fields: { email: string; firstName: string; passwordHash?: string; acquisition?: Acquisition | null; locale?: Locale },
): Promise<ClaimResult> {
  const guest = await app.collections.users.findOne({ _id: guestId }, { projection: { guest: 1, acquisition: 1, firstName: 1 } })

  if (!guest?.guest) {
    return { ok: false, reason: 'not_guest' }
  }

  if (await app.collections.users.findOne({ email: fields.email }, { projection: { _id: 1 } })) {
    return { ok: false, reason: 'email_taken' }
  }

  const now = new Date()

  try {
    const user = await app.collections.users.findOneAndUpdate(
      { _id: guestId, guest: true },
      {
        $set: {
          email: fields.email,
          firstName: fields.firstName || guest.firstName,
          claimedAt: now,
          lastLoginAt: now,
          ...(fields.locale ? { locale: fields.locale } : {}),
          updatedAt: now,
          ...(fields.passwordHash ? { passwordHash: fields.passwordHash, passwordUpdatedAt: now } : {}),
          // The first touch the browser knew when they started wins.
          ...(guest.acquisition ? {} : fields.acquisition ? { acquisition: fields.acquisition } : {}),
        },
        $unset: { guest: '', emailTipsOptOutAt: '' },
      },
      { returnDocument: 'after' },
    )

    return user ? { ok: true, user } : { ok: false, reason: 'not_guest' }
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return { ok: false, reason: 'email_taken' }
    }

    throw error
  }
}

// Guests who never saved, after GUEST_TTL_DAYS: their selfie, colors and
// anything they made, their sessions, and the account itself. Nobody can
// sign back in to a guest once its cookies are gone, so it would only sit
// there.
export async function deleteStaleGuests(app: FastifyInstance, now = new Date()) {
  const stale = await app.collections.users
    .find({ guest: true, createdAt: { $lt: new Date(now.getTime() - env.GUEST_TTL_DAYS * DAY_MS) } }, { projection: { _id: 1 } })
    .limit(200)
    .toArray()

  for (const { _id: userId } of stale) {
    await deleteUserContent(app, userId)
    await Promise.all([
      app.collections.refreshTokens.deleteMany({ userId }),
      app.collections.passkeys.deleteMany({ userId }),
      app.collections.authChallenges.deleteMany({ userId }),
    ])
    await app.collections.users.deleteOne({ _id: userId, guest: true })
  }

  return stale.length
}

export function startGuestCleanup(app: FastifyInstance) {
  const run = () => {
    void deleteStaleGuests(app)
      .then((count) => {
        if (count > 0) {
          app.log.info({ count }, 'Unsaved guests deleted')
        }
      })
      .catch((error: unknown) => app.log.error({ err: error }, 'Guest cleanup crashed'))
  }

  setTimeout(run, 2 * 60 * 1000).unref()
  setInterval(run, 60 * 60 * 1000).unref()
}
