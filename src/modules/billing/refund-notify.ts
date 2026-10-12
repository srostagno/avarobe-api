import type { FastifyBaseLogger } from 'fastify'

import { env } from '../../config/env.js'
import { dayMonth, formatMoney } from '../../i18n/emails.js'
import type { PurchaseProduct, RefundReason, RefundRequestDocument, RefundRequestFlag, UserDocument } from '../../types/mongo.js'
import { deliverEmail, type ReplyTo } from '../../utils/email.js'
import type { Locale } from '../../utils/locale.js'
import { shortProductName } from '../lifecycle/checkout-link.js'
import { type EmailContent, type RefundEmailInput, refundApprovedEmail, refundReceivedEmail, refundRejectedEmail } from '../lifecycle/templates.js'
import { alertContent, chileTime } from '../ops/alerts.js'
import { isPro } from './refunds.js'

// The emails of a refund request (billing/refund-requests.ts): the
// founder's copy of each new request and the reminders, in Spanish with
// Chile's time (as the operations alerts), and the customer's, in their
// language. Sending is claimed on the request first (refund-requests.ts).

type RefundPlanLike = { total: number; currency: string; endsPro: boolean }

// What approval takes away, as the customer's emails say it.
export function refundKind(product: PurchaseProduct): RefundEmailInput['kind'] {
  if (isPro(product)) return 'pro'
  if (product === 'look_pack') return 'pack'
  if (product === 'outfit_guide') return 'guide'
  return 'report'
}

// Where dates are read: the market each language is mostly read in.
const READER_TIME_ZONE: Record<Locale, string> = { en: 'America/New_York', 'pt-BR': 'America/Sao_Paulo', es: 'America/Mexico_City' }

export async function sendClaimedEmail(log: FastifyBaseLogger, input: { to: string; content: EmailContent; replyTo?: ReplyTo }) {
  return deliverEmail({ log, to: { email: input.to }, content: input.content, ...(input.replyTo ? { replyTo: input.replyTo } : {}) })
}

// ---------------------------------------------------------------- customer

function customerInput(request: RefundRequestDocument, amount = request.amount): RefundEmailInput {
  const locale = request.locale

  return {
    email: request.email ?? '',
    firstName: request.firstName,
    locale,
    ref: request.ref,
    product: shortProductName(request.product, locale),
    price: formatMoney(amount, request.currency, locale),
    purchasedOn: dayMonth(request.purchasedAt, locale, READER_TIME_ZONE[locale]),
    kind: refundKind(request.product),
  }
}

// "We got your refund request": the ref, the 2 business days, what approval
// removes, Pro's paused renewal and Brazil's right when they apply.
export function receivedEmailFor(request: RefundRequestDocument) {
  return refundReceivedEmail({
    ...customerInput(request),
    category: request.reasonCategory,
    proPaused: Boolean(request.proPause),
    statutory: Boolean(request.statutory),
  })
}

// The decision: approved (what went back) or rejected (why, the founder's
// note, and Pro: its renewal when it was put back, or the day it ended while
// its renewal was paused for the review).
export function decisionEmailFor(request: RefundRequestDocument, extra: { proRenewsAt: Date | null; proEndedAt?: Date | null }) {
  if (request.status === 'refunded') {
    return refundApprovedEmail(customerInput(request, request.refund?.amount || request.amount))
  }

  const input = customerInput(request)

  return refundRejectedEmail({
    ...input,
    code: request.decision?.code ?? 'other',
    note: request.decision?.note ?? null,
    proRenewsOn: extra.proRenewsAt ? dayMonth(extra.proRenewsAt, input.locale, READER_TIME_ZONE[input.locale]) : null,
    proEndedOn: extra.proEndedAt ? dayMonth(extra.proEndedAt, input.locale, READER_TIME_ZONE[input.locale]) : null,
  })
}

// ---------------------------------------------------------------- founder

const CATEGORY_ES: Record<RefundReason, string> = {
  not_accurate: 'Sus colores o su estación no coinciden',
  quality: 'Resultados malos o de baja calidad',
  technical: 'Algo no funcionó o no pudo entrar',
  not_expected: 'No es lo que describía la página',
  duplicate: 'Pagó dos veces o ya lo tenía',
  mistake: 'Lo compró por error',
  other: 'Otro',
}

const LANGUAGE_ES: Record<Locale, string> = { en: 'inglés', 'pt-BR': 'portugués', es: 'español' }

const usd = (cents: number) => `US$ ${(cents / 100).toFixed(2)}`
// "R$ 14,90", "US$ 4.99", "MXN 79.00", "COP 11.900": each currency as the
// founder reads it, never a bare "$" that reads as dollars (Spanish writes
// pesos with "$").
const money = (amount: number, currency: string) => {
  const code = currency.toLowerCase()

  if (code === 'brl') return formatMoney(amount, currency, 'pt-BR')
  if (code === 'usd') return usd(amount)

  const whole = code === 'cop'

  return new Intl.NumberFormat(whole ? 'es-CO' : 'es-MX', {
    style: 'currency',
    currency: currency.toUpperCase(),
    currencyDisplay: 'code',
    ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
  }).format(amount / 100)
}
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

const BRAZIL_TIME = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Sao_Paulo',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const day = (date: Date) => date.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Santiago' })

function flagLine(flag: RefundRequestFlag, request: RefundRequestDocument) {
  const history = request.history

  switch (flag) {
    case 'repeat':
      return `Ya tuvo ${plural(history.refundsBefore, 'reembolso', 'reembolsos')}`
    case 'requested_before':
      return `Ya pidió reembolso antes (${plural(history.requestsBefore, 'solicitud', 'solicitudes')})`
    case 'credit_used':
      return 'Su crédito pagó parte de un Pro anual que conserva'
    case 'used':
      return 'Lo usó'
    case 'heavy_use':
      return 'Uso alto'
    case 'card_seen':
      return 'La misma tarjeta aparece en otra cuenta'
    case 'many_open':
      return `Tiene ${history.openRequests} solicitudes abiertas`
    case 'new_account':
      return 'Cuenta creada menos de 1 h antes de pagar'
    case 'charged_during_review':
      return 'Hubo un cobro de Pro durante la revisión'
    case 'disputed':
      return 'Cargo en disputa'
    case 'old_guarantee':
      return 'Garantía antigua'
  }
}

const COLOR_USE = new Set<string>(['color_report', 'color_addon', 'color_mirror', 'reports_bundle', 'advisors_bundle'])
const STYLE_USE = new Set<string>(['style_report', 'style_addon', 'reports_bundle', 'advisors_bundle'])

// Only the lines that say something about this product.
function usageLines(request: RefundRequestDocument) {
  const usage = request.usage
  const product = request.product
  const pro = isPro(product)
  const opened = (label: string, at: Date | null) => `${label}: ${at ? `abierto el ${chileTime(at)}` : 'no abierto'}`
  const lines: string[] = []

  if (request.userId) {
    if (COLOR_USE.has(product) || pro) lines.push(opened('Reporte de colores', usage.colorReportOpenedAt))
    if (STYLE_USE.has(product) || pro) lines.push(opened('Reporte de estilo', usage.styleReportOpenedAt))
    if (product === 'hair_advisor' || product === 'advisors_bundle' || pro) {
      lines.push(`Lectura de cabello: ${usage.hairReadAt ? `lista el ${chileTime(usage.hairReadAt)}` : 'no hecha'}`)
    }

    if (usage.creditsGiven > 0 || pro || product === 'look_pack') {
      lines.push(
        `Looks desde la compra: ${usage.looksMade} (${usage.looksWithCredit} con crédito) · créditos que dio: ${usage.creditsGiven} · le quedan: ${usage.creditsLeft ?? '?'}`,
      )
    }

    lines.push(`Peinados: ${usage.hairstylesMade} · Eventos: ${usage.eventsStyled} · Revistas: ${usage.magazinesMade} · Revisiones de color: ${usage.checksMade}`)

    if (pro && usage.avatarRuns !== null) {
      lines.push(`Cambios de avatar este mes (Pro): ${usage.avatarRuns}`)
    }
  }

  if (usage.guideDownloads !== null) {
    lines.push(`Descargas del libro: ${usage.guideDownloads}${usage.guideLastDownloadAt ? ` (última ${chileTime(usage.guideLastDownloadAt)})` : ''}`)
  }

  lines.push(`Última actividad: ${usage.lastSeenAt ? chileTime(usage.lastSeenAt) : 'sin registro'}`)

  return lines
}

// Each new request, for the founder at REFUNDS_EMAIL (reply-to the
// customer): who, what and when, how much, how it was used, why in their
// own words (escaped and quoted), the signals and exactly what approving
// does, with the link to decide in the admin.
// A Brazilian withdrawal known only by the language (Avarobe in Brazilian
// Portuguese, whose copy promises 7 days to withdraw): paid in another
// currency, with no Brazilian card or sign-up.
export function languageOnly(statutory: RefundRequestDocument['statutory']) {
  return Boolean(statutory?.basis?.length) && Boolean(statutory?.basis?.every((basis) => basis === 'language'))
}

export function founderEmail(input: {
  request: RefundRequestDocument
  account: Pick<UserDocument, 'createdAt' | 'location' | 'locale' | 'acquisition'> | null
  plan: RefundPlanLike
  removesEs: string[]
  // Pro's paused subscription ends before the review is due (proPauseEnd).
  proEnd?: { at: Date; trial: boolean; ended: boolean } | null
  test: boolean
}): EmailContent {
  const { request, account, plan } = input
  const history = request.history
  const product = shortProductName(request.product, 'es')
  const price = money(request.amount, request.currency)
  const byLanguage = languageOnly(request.statutory)
  const statutoryTag = request.statutory ? (byLanguage ? '[BR art. 49 · solo idioma] ' : '[BR art. 49] ') : ''
  const prefixes = [statutoryTag, request.oldGuarantee ? '[Garantía antigua] ' : '', input.test ? '[PRUEBA] ' : ''].join('')
  const subject = `${prefixes}Reembolso ${request.ref}: ${product} · ${price} · ${request.email ?? 'sin correo'}`.replace(/[\r\n]+/g, ' ')
  const location = account?.location ? `${account.location.country}${account.location.region ? `-${account.location.region}` : ''}` : (request.market.signupCountry ?? request.market.requestCountry ?? 'país desconocido')
  const card = request.market.card
  const hours = Math.max(0, Math.round((request.createdAt.getTime() - request.purchasedAt.getTime()) / 3_600_000))
  const who = request.userId
    ? `${request.firstName || 'Sin nombre'} <${request.email ?? 'sin correo'}> · cuenta …${request.userId.toString().slice(-6)}`
    : `${request.email ?? 'sin correo'} · sin cuenta, compró el libro como invitado`
  const removes = input.removesEs.length ? input.removesEs.join(', ') : 'nada (la cuenta ya no existe)'

  const lines = [
    `Nueva solicitud de reembolso ${request.ref} · pendiente`,
    ...(request.statutory && !byLanguage
      ? [
          `DERECHO DE ARREPENTIMIENTO (Brasil, CDC art. 49): la pidió dentro de los 7 días, así que hay que reembolsarla. Decide dentro de 1 día hábil (plazo de la compra: ${BRAZIL_TIME.format(request.statutory.until)} hora de Brasil).`,
        ]
      : []),
    ...(request.statutory && byLanguage
      ? [
          `DERECHO DE ARREPENTIMIENTO (Brasil, CDC art. 49), solo por el idioma: usa Avarobe en portugués, cuyo texto promete 7 días para desistir, pero pagó en ${request.currency.toUpperCase()}${request.market.card?.country ? ` con tarjeta de ${request.market.card.country}` : ''} y ${request.market.signupCountry ? `se registró en ${request.market.signupCountry}` : 'no sabemos dónde se registró'}. La pidió dentro de los 7 días (hasta ${BRAZIL_TIME.format(request.statutory.until)} hora de Brasil): rechazarla exige confirmar la excepción.`,
        ]
      : []),
    ...(request.oldGuarantee ? ['Compra hecha con la garantía antigua (Términos del 8 de octubre): corresponde aprobarla.'] : []),
    '',
    `Revisar y decidir: ${env.APP_URL}/studio/admin/refunds?request=${request._id.toString()}`,
    '',
    'QUIÉN',
    who,
    ...(account
      ? [
          `Registro: ${day(account.createdAt)} · ${location} · idioma ${LANGUAGE_ES[account.locale ?? 'en']} · llegó por ${account.acquisition?.channel ?? 'desconocido'}${account.acquisition?.campaign ? ` / ${account.acquisition.campaign}` : ''}`,
        ]
      : [`País: ${location} · idioma ${LANGUAGE_ES[request.locale]}`]),
    `Pagado en total: ${usd(history.paidUsd)} en ${plural(history.purchases, 'compra', 'compras')} · reembolsos antes: ${history.refundsBefore} · solicitudes antes: ${history.requestsBefore} (${history.approvedBefore} aprobadas, ${history.rejectedBefore} rechazadas)`,
    '',
    'QUÉ COMPRÓ',
    `${product} · ${price} (≈ ${usd(request.amountUsd)}) · pagado el ${chileTime(request.purchasedAt)} · hace ${hours} h`,
    ...(request.covers.length > 1
      ? request.covers.map((cover) => `- ${shortProductName(cover.product, 'es')} · ${money(cover.amount, cover.currency)} · pagado el ${chileTime(cover.paidAt)}`)
      : []),
    card
      ? `Tarjeta: ${card.brand ?? 'tarjeta'} ••${card.last4 ?? '????'} (${card.country ?? '?'})${request.market.disputed ? ' · EN DISPUTA' : ''}`
      : `Tarjeta: sin datos de Stripe${request.market.disputed ? ' · EN DISPUTA' : ''}`,
    '',
    'POR QUÉ',
    `Motivo: ${CATEGORY_ES[request.reasonCategory]}`,
    `"${request.explanation}"`,
    `Captura: ${request.attachment ? 'sí, en el panel' : 'no'}`,
    '',
    'USO (al pedirlo)',
    ...usageLines(request),
    '',
    'SEÑALES (solo para revisar; nada se rechaza solo)',
    ...(request.flags.length ? request.flags.map((flag) => flagLine(flag, request)) : ['ninguna']),
    '',
    'SI APRUEBAS',
    `Se devuelven ${money(plan.total, plan.currency)} a la tarjeta y se quita: ${removes}.${plan.endsPro ? ' Pro termina hoy.' : ''}`,
    ...(request.proPause && !request.proPause.wasCancelAtPeriodEnd ? ['Pro: la renovación quedó pausada mientras decides.'] : []),
    ...(input.proEnd
      ? [
          input.proEnd.ended
            ? `Pro: ${input.proEnd.trial ? 'su prueba' : 'su periodo'} terminó el ${chileTime(input.proEnd.at)} con la renovación pausada; si rechazas, Pro no vuelve (se le dice).`
            : `Pro: ${input.proEnd.trial ? 'su prueba' : 'su periodo'} termina el ${chileTime(input.proEnd.at)}, antes del plazo de revisión. Decide antes: si rechazas después, Pro ya habrá terminado (se le dice).`,
        ]
      : []),
    ...(request.internalNote ? ['', `Nota: ${request.internalNote}`] : []),
    '',
    request.email ? 'Para escribirle, responde a este correo.' : 'No dejó correo: escríbele desde su cuenta si hace falta.',
  ]

  return alertContent(subject, lines)
}

// One digest of the requests waiting too long (24 h; 12 h for a Brazilian
// withdrawal) and of approvals that stopped halfway, each with its link.
export function reminderDigest(requests: RefundRequestDocument[], now: Date): EmailContent {
  const statutory = requests.filter((request) => request.statutory).length
  const subject = `${statutory ? '[BR art. 49] ' : ''}Reembolsos por decidir: ${requests.length}`
  const lines = [
    `${plural(requests.length, 'solicitud de reembolso espera', 'solicitudes de reembolso esperan')} tu decisión:`,
    '',
    ...requests.flatMap((request) => [
      `${request.ref} · ${shortProductName(request.product, 'es')} · ${money(request.amount, request.currency)} · ${request.email ?? 'sin correo'} · pedida hace ${Math.round((now.getTime() - request.createdAt.getTime()) / 3_600_000)} h${request.statutory ? (languageOnly(request.statutory) ? ' · BR art. 49 (solo idioma)' : ' · BR art. 49: hay que reembolsarla') : ''}${request.status === 'failed' ? ' · Stripe falló, reintenta' : ''}${request.status === 'approved' ? ' · la aprobación quedó a medias: ábrela y apruébala de nuevo para terminarla' : ''}`,
      `${env.APP_URL}/studio/admin/refunds?request=${request._id.toString()}`,
      '',
    ]),
    'Se avisa una vez por solicitud.',
  ]

  return alertContent(subject, lines)
}
