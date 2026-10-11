import type { FastifyBaseLogger, FastifyInstance } from 'fastify'

import { env } from '../../config/env.js'
import type { OpsAlertDocument } from '../../types/mongo.js'
import { deliverEmail } from '../../utils/email.js'
import { isDuplicateKeyError } from '../../utils/mongo-errors.js'
import { classifyAiError, onOpenAiError, redactAiMessage, type AiFailure, type OpenAiRequestError } from '../../utils/openai.js'
import { trackServerEvent } from '../analytics/service.js'

// Emails to the founder when the AI behind the color reads stops working.
// On 11-Oct-2026 OpenAI ran out of credits and every read failed for two
// hours before anyone noticed. Out of credits (or a bad key) alerts at once;
// reads failing for anyone (3 people in 10 minutes) alerts too. At most one
// of each an hour, kept in Mongo so restarts and deploys don't resend it,
// and one email when reads work again. Internal, so in Spanish only, with
// Chile's time. A failed alert is logged, never thrown.

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const ALERT_RULES = {
  every: HOUR,
  readsWindow: 10 * MINUTE,
  readsAtLeast: 3,
} as const

const BILLING_URL = 'https://platform.openai.com/settings/organization/billing/overview'
const STATUS_URL = 'https://status.openai.com'
const FOOTER =
  'Quienes dejaron su email reciben sus colores solos cuando vuelva a funcionar. Te escribo como máximo una vez por hora mientras siga fallando.'

const CODE_LABELS: Record<AiFailure, string> = {
  no_credits: 'sin créditos',
  account: 'clave o configuración',
  rate_limited: 'límite de uso',
  provider: 'OpenAI caído o lento',
  rejected: 'foto rechazada',
  internal: 'error nuestro',
}

// ---------------------------------------------------------------- pure

// Reads failing: enough people in the window, and neither this alert nor the
// credits one (which already explains it) in the last hour.
export function shouldAlertReads(count: number, lastReadsAt: Date | null, lastAccountAt: Date | null, now: Date) {
  const recent = (at: Date | null) => at !== null && now.getTime() - at.getTime() < ALERT_RULES.every

  return count >= ALERT_RULES.readsAtLeast && !recent(lastReadsAt) && !recent(lastAccountAt)
}

const CHILE = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function chileTime(date: Date) {
  return `${CHILE.format(date)} (hora de Chile)`
}

export function duration(ms: number) {
  const minutes = Math.max(1, Math.round(ms / MINUTE))
  const hours = Math.floor(minutes / 60)

  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function alertContent(subject: string, lines: string[]) {
  const text = lines.join('\n')

  return { subject, text, html: escapeHtml(text).replace(/\n/g, '<br>\n') }
}

function emailList(value: string) {
  return value
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

// ---------------------------------------------------------------- sending

let warnedFallback = false

function recipients(log: FastifyBaseLogger) {
  const own = emailList(env.ALERT_EMAILS)

  if (own.length > 0) {
    return own
  }

  if (!warnedFallback) {
    warnedFallback = true
    log.warn('ALERT_EMAILS is empty: operations alerts go to COMP_EMAILS')
  }

  return emailList(env.COMP_EMAILS)
}

// An alert may be open: worth a look on the next successful read.
let maybeOpen = true

// Takes the alert for this hour, atomically: false if it already went out
// (another process, or a few seconds ago). `openSince` keeps the start of
// the trouble across hourly alerts. Returns the alert as it was.
async function claimAlert(app: FastifyInstance, id: OpsAlertDocument['_id'], lastError: string | null, now: Date) {
  try {
    const before = await app.collections.opsAlerts.findOneAndUpdate(
      { _id: id, lastSentAt: { $lt: new Date(now.getTime() - ALERT_RULES.every) } },
      [{ $set: { lastSentAt: now, lastError, openSince: { $ifNull: ['$openSince', now] } } }],
      { upsert: true, returnDocument: 'before' },
    )

    return { claimed: true as const, before }
  } catch (error) {
    // The upsert found the alert sent within the hour.
    if (isDuplicateKeyError(error)) {
      return { claimed: false as const, before: null }
    }

    throw error
  }
}

// A claimed alert that couldn't be delivered: free it, so the next failure
// tries again instead of waiting an hour.
async function releaseAlert(app: FastifyInstance, id: OpsAlertDocument['_id'], before: OpsAlertDocument | null, now: Date) {
  await app.collections.opsAlerts.updateOne({ _id: id, lastSentAt: now }, { $set: { lastSentAt: before?.lastSentAt ?? new Date(0) } })
}

async function send(app: FastifyInstance, kind: string, content: ReturnType<typeof alertContent>) {
  const to = recipients(app.log)
  let delivered = 0

  // In the log too, for when the email doesn't arrive.
  app.log.warn({ kind, subject: content.subject, text: content.text }, 'Operations alert')

  for (const email of to) {
    try {
      await deliverEmail({ log: app.log, to: { email }, content })
      delivered += 1
    } catch (error) {
      app.log.error({ err: error, kind }, 'Operations alert not delivered')
    }
  }

  maybeOpen = true
  void trackServerEvent(app, { name: 'ops_alert_sent', userId: null, props: { kind } })

  return to.length === 0 || delivered > 0
}

// ---------------------------------------------------------------- facts

const pendingFilter = (now: Date) => ({
  'colorsNotify.requestedAt': { $gte: new Date(now.getTime() - DAY) },
  'colorsNotify.sentAt': null,
  'colorsNotify.gaveUpAt': null,
})

// People waiting for their colors by email.
function pendingNotices(app: FastifyInstance, now: Date) {
  return app.collections.avatars.countDocuments(pendingFilter(now))
}

// People whose color read failed since then, and still has: by kind, guests
// or accounts, and the last error.
async function failedSince(app: FastifyInstance, since: Date) {
  const avatars = await app.collections.avatars
    .find(
      { status: 'failed', updatedAt: { $gte: since }, 'failure.at': { $gte: since } },
      { projection: { userId: 1, failure: 1 }, sort: { 'failure.at': -1 }, limit: 500 },
    )
    .toArray()
  const users = await app.collections.users
    .find({ _id: { $in: avatars.map((avatar) => avatar.userId) } }, { projection: { guest: 1 } })
    .toArray()
  const guests = users.filter((user) => user.guest).length
  const byCode = new Map<AiFailure, number>()

  for (const avatar of avatars) {
    const code = avatar.failure?.code ?? 'internal'
    byCode.set(code, (byCode.get(code) ?? 0) + 1)
  }

  return {
    count: avatars.length,
    guests,
    accounts: avatars.length - guests,
    byCode,
    lastDetail: avatars[0]?.failure?.detail ?? null,
  }
}

// ---------------------------------------------------------------- alerts

// OpenAI out of credits, or refusing the key: every AI feature is down until
// someone acts, so it goes out at the first error.
export async function alertAccount(
  app: FastifyInstance,
  error: OpenAiRequestError,
  failure: 'no_credits' | 'account',
  now = new Date(),
) {
  const detail = redactAiMessage(error.message)

  try {
    if (recipients(app.log).length === 0) {
      app.log.error({ failure, detail }, 'OpenAI account problem, and no ALERT_EMAILS or COMP_EMAILS to tell')
      return
    }

    const claim = await claimAlert(app, 'openai_account', detail, now)

    if (!claim.claimed) {
      return
    }

    const hourAgo = new Date(now.getTime() - HOUR)
    const [failed, pending] = await Promise.all([failedSince(app, hourAgo), pendingNotices(app, now)])
    const subject =
      failure === 'no_credits'
        ? 'Avarobe: OpenAI sin créditos — las lecturas de color están fallando'
        : 'Avarobe: OpenAI rechaza la clave o la configuración — las lecturas de color están fallando'
    const content = alertContent(subject, [
      `OpenAI respondió HTTP ${error.statusCode} (${error.code ?? 'sin código'} / ${error.type ?? 'sin tipo'}). Mientras siga así fallan las lecturas de color, la foto en tus colores y todo lo que usa IA.`,
      `Desde: ${chileTime(claim.before?.openSince ?? now)}`,
      `Personas con la lectura fallida en la última hora: ${failed.count} (${failed.guests} invitados)`,
      `Esperando aviso por email: ${pending}`,
      `Último error: ${detail}`,
      `Recargar créditos: ${BILLING_URL}`,
      FOOTER,
    ])

    if (!(await send(app, 'openai_account', content))) {
      await releaseAlert(app, 'openai_account', claim.before, now)
    }
  } catch (alertError) {
    app.log.error({ err: alertError }, 'OpenAI account alert failed')
  }
}

// Hears every failed OpenAI call (utils/openai.ts), from any feature.
export function watchOpenAi(app: FastifyInstance) {
  onOpenAiError((error) => {
    const failure = classifyAiError(error)

    if (failure === 'no_credits' || failure === 'account') {
      void alertAccount(app, error, failure)
    }
  })
}

// After each failed color read: several people failing within minutes,
// whatever the reason, is worth a look. Never throws.
export async function noteReadFailed(app: FastifyInstance, now = new Date()) {
  try {
    const since = new Date(now.getTime() - ALERT_RULES.readsWindow)
    const count = await app.collections.avatars.countDocuments({ status: 'failed', updatedAt: { $gte: since }, 'failure.at': { $gte: since } })

    if (count < ALERT_RULES.readsAtLeast) {
      return
    }

    const alerts = await app.collections.opsAlerts.find({ _id: { $in: ['reads_failing', 'openai_account'] } }).toArray()
    const lastAt = (id: OpsAlertDocument['_id']) => alerts.find((alert) => alert._id === id)?.lastSentAt ?? null

    if (!shouldAlertReads(count, lastAt('reads_failing'), lastAt('openai_account'), now) || recipients(app.log).length === 0) {
      return
    }

    const [failed, pending] = await Promise.all([failedSince(app, since), pendingNotices(app, now)])
    const claim = await claimAlert(app, 'reads_failing', failed.lastDetail, now)

    if (!claim.claimed) {
      return
    }

    const kinds = [...failed.byCode.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([code, n]) => `${CODE_LABELS[code]} (${code}): ${n}`)
      .join(', ')
    const content = alertContent(`Avarobe: ${failed.count} lecturas de color fallaron en 10 min`, [
      `${failed.count} personas no pudieron leer sus colores en los últimos 10 minutos.`,
      `Por tipo: ${kinds}`,
      `Invitados: ${failed.guests} · Con cuenta: ${failed.accounts}`,
      `Esperando aviso por email: ${pending}`,
      `Último error: ${failed.lastDetail ?? 'sin detalle'}`,
      `Estado de OpenAI: ${STATUS_URL}`,
      FOOTER,
    ])

    if (!(await send(app, 'reads_failing', content))) {
      await releaseAlert(app, 'reads_failing', claim.before, now)
    }
  } catch (error) {
    app.log.error({ err: error }, 'Reads failing alert failed')
  }
}

// After each successful color read: if an alert is open, close it and say
// so, once. Skips the database while nothing has been sent since boot.
export async function noteReadSucceeded(app: FastifyInstance, now = new Date()) {
  if (!maybeOpen) {
    return
  }

  try {
    const closed: Date[] = []

    for (const id of ['openai_account', 'reads_failing'] as const) {
      const before = await app.collections.opsAlerts.findOneAndUpdate(
        { _id: id, openSince: { $ne: null } },
        { $set: { openSince: null } },
        { returnDocument: 'before' },
      )

      if (before?.openSince) {
        closed.push(before.openSince)
      }
    }

    if (closed.length === 0) {
      maybeOpen = false
      return
    }

    const since = new Date(Math.min(...closed.map((at) => at.getTime())))
    const [failedIds, pending] = await Promise.all([
      app.collections.analyticsEvents.distinct('userId', { name: 'colors_failed', origin: 'server', at: { $gte: since, $lte: now } }),
      pendingNotices(app, now),
    ])
    const content = alertContent('Avarobe: las lecturas de color funcionan de nuevo', [
      `Las lecturas de color volvieron a funcionar: ${chileTime(now)}.`,
      `Estuvieron fallando desde ${chileTime(since)} (${duration(now.getTime() - since.getTime())}).`,
      `Personas con una lectura fallida en ese lapso: ${failedIds.filter(Boolean).length}`,
      `Esperando aviso por email: ${pending}${pending > 0 ? ' (se les envía su lectura en los próximos minutos)' : ''}`,
    ])

    await send(app, 'recovered', content)
  } catch (error) {
    app.log.error({ err: error }, 'Recovery alert failed')
  }
}
