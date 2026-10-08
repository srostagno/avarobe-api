import type {
  AvatarDocument,
  CollectionDocument,
  LookDocument,
  UserDocument,
} from '../types/mongo.js'
import { env } from '../config/env.js'
import { currentHair } from '../modules/avatar/hair.js'
import { serializeBilling } from '../modules/billing/entitlements.js'
import { fixIsFree } from '../modules/looks/fixes.js'
import { signedUrlOrNull } from './storage.js'

// Came for their colors (a color guide, or a Colors ad): the studio starts
// with a selfie and their colors, and the avatar comes after.
export function focusOf(user: Pick<UserDocument, 'acquisition'>): 'colors' | null {
  const landing = user.acquisition?.landing ?? ''
  const content = user.acquisition?.content ?? ''

  return landing.startsWith('/color-analysis') || content.startsWith('colors') ? 'colors' : null
}

export function serializeUser(user: UserDocument) {
  return {
    id: user._id.toString(),
    // A guest (trying before an account) has no email of its own yet.
    email: user.guest ? '' : user.email,
    guest: Boolean(user.guest),
    firstName: user.firstName,
    focus: focusOf(user),
    hasPassword: Boolean(user.passwordHash),
    emailVerified: Boolean(user.emailVerifiedAt),
    emailTips: !user.emailTipsOptOutAt,
    billing: serializeBilling(user),
    createdAt: user.createdAt.toISOString(),
  }
}

// Without the Color Advisor the palette shows the season, undertone and
// contrast, and no colors at all: every best color, neutral and color to
// avoid stays on the server (Oct 2026: no best colors before they pay),
// with counts so the page can hint at them.
function serializeColorAnalysis(analysis: AvatarDocument['colorAnalysis'], full: boolean) {
  if (!analysis || full) {
    return analysis ? { ...analysis, locked: false } : null
  }

  const freeBest: typeof analysis.bestColors = []

  return {
    season: analysis.season,
    undertone: analysis.undertone,
    contrast: analysis.contrast,
    summary: analysis.summary,
    bestColors: freeBest,
    neutrals: [],
    avoidColors: [],
    metals: analysis.metals,
    confidence: analysis.confidence,
    photoNote: analysis.photoNote,
    locked: true,
    lockedCounts: {
      bestColors: Math.max(0, analysis.bestColors.length - freeBest.length),
      neutrals: analysis.neutrals.length,
      avoidColors: analysis.avoidColors.length,
    },
  }
}

export async function serializeAvatar(avatar: AvatarDocument, options: { fullPalette: boolean; mirror?: boolean }) {
  // Before they unlock their colors (the Color Advisor, or the color mirror,
  // which shows their #1 live), the photo shows only their worst color (the
  // locked copy, until it exists: nothing).
  const bestLocked = env.LOCK_BEST_COLOR && !options.fullPalette && !options.mirror
  const layout = avatar.drapePreview?.layout ?? 'pair'
  const drapeKey = bestLocked ? (avatar.drapePreview?.lockedKey ?? null) : (avatar.drapePreview?.key ?? null)
  const [avatarUrl, selfieUrl, bodyPhotoUrl, previewUrl, drapePreviewUrl, versions] = await Promise.all([
    signedUrlOrNull(avatar.avatarKey),
    signedUrlOrNull(avatar.selfieKey),
    signedUrlOrNull(avatar.bodyPhotoKey ?? null),
    signedUrlOrNull(avatar.job?.previewKey ?? null),
    signedUrlOrNull(avatar.drapePreview?.status === 'ready' ? drapeKey : null),
    Promise.all(
      (avatar.versions ?? []).map(async (version) => ({
        id: version.id,
        url: await signedUrlOrNull(version.key),
        source: version.source,
        // The Hair studio haircut this version wears, if not the selfie's.
        hair: version.hair ? { hairstyleId: version.hair.hairstyleId, name: version.hair.name } : null,
        createdAt: version.createdAt.toISOString(),
        current: version.key === avatar.avatarKey,
      })),
    ),
  ])

  return {
    id: avatar._id.toString(),
    status: avatar.status,
    error: avatar.error,
    body: avatar.body,
    // How they shop: the body's, or asked before it (colors first).
    presentation: avatar.body?.presentation ?? avatar.presentation ?? null,
    colorAnalysis: serializeColorAnalysis(avatar.colorAnalysis, options.fullPalette),
    // The color mirror drapes all their colors, so its owners get them for
    // the mirror even without the Color Advisor (whose palette stays locked).
    mirrorColors:
      options.mirror && !options.fullPalette && avatar.colorAnalysis
        ? {
            bestColors: avatar.colorAnalysis.bestColors,
            neutrals: avatar.colorAnalysis.neutrals,
            avoidColors: avatar.colorAnalysis.avoidColors,
          }
        : null,
    // Free: their worst color on their face; their best ones too, unless
    // LOCK_BEST_COLOR keeps them (and their names) for those who unlock them.
    drapePreview: avatar.drapePreview
      ? {
          status: avatar.drapePreview.status,
          url: drapePreviewUrl,
          layout,
          best: bestLocked ? null : avatar.drapePreview.best,
          bests: bestLocked ? null : (avatar.drapePreview.bests ?? null),
          worst: avatar.drapePreview.worst,
          bestLocked,
        }
      : null,
    avatarUrl,
    selfieUrl,
    bodyPhotoUrl,
    versions,
    hair: (() => {
      const hair = currentHair(avatar)
      return hair ? { hairstyleId: hair.hairstyleId, name: hair.name } : null
    })(),
    job: avatar.job
      ? {
          kind: avatar.job.kind,
          startedAt: avatar.job.startedAt.toISOString(),
          previewUrl,
          previewCount: avatar.job.previewCount,
        }
      : null,
    createdAt: avatar.createdAt.toISOString(),
    updatedAt: avatar.updatedAt.toISOString(),
    readyAt: avatar.readyAt?.toISOString() ?? null,
  }
}

export async function serializeLook(look: LookDocument) {
  return {
    id: look._id.toString(),
    batchId: look.batchId.toString(),
    occasion: look.occasion,
    plan: look.plan,
    source: look.source ?? 'stylist',
    iconId: look.iconId ?? null,
    eventId: look.eventId?.toString() ?? null,
    analysis: look.analysis?.data ?? null,
    referenceUrl: await signedUrlOrNull(look.referenceKey ?? null),
    pieces: await Promise.all(
      (look.pieces ?? []).map(async (piece) => ({
        id: piece.id,
        slot: piece.slot,
        name: piece.name,
        color: piece.color,
        colorHex: piece.colorHex,
        material: piece.material,
        fit: piece.fit,
        status: piece.status,
        imageUrl: await signedUrlOrNull(piece.imageKey),
      })),
    ),
    status: look.status,
    error: look.error,
    imageUrl: await signedUrlOrNull(look.imageKey),
    previewUrl: look.status === 'processing' ? await signedUrlOrNull(look.previewKey ?? null) : null,
    // A locked look already drawn: only its blurred copy, never the picture.
    lockedImageUrl:
      look.status === 'locked' && look.teaser?.status === 'ready' ? await signedUrlOrNull(look.teaser.lockedKey) : null,
    // Still drawing it: pages check back until the blurred copy is there.
    teaserPending: look.status === 'locked' && look.teaser?.status === 'processing',
    collectionIds: look.collectionIds.map((id) => id.toString()),
    favorite: look.favorite,
    feedback: look.feedback
      ? {
          rating: look.feedback.rating,
          aspects: look.feedback.aspects,
          pieces: look.feedback.pieces,
          note: look.feedback.note,
          at: look.feedback.at.toISOString(),
        }
      : null,
    remixOf: look.remixOf?.toString() ?? null,
    remix: look.remix ?? null,
    // Its fix costs no look (looks/fixes.ts).
    fixFree: fixIsFree(look),
    createdAt: look.createdAt.toISOString(),
    renderStartedAt: (look.renderStartedAt ?? look.createdAt).toISOString(),
    readyAt: look.readyAt?.toISOString() ?? null,
  }
}

export async function serializeCollection(
  collection: CollectionDocument,
  extras: { lookCount: number; coverKeys: string[] },
) {
  return {
    id: collection._id.toString(),
    name: collection.name,
    lookCount: extras.lookCount,
    coverUrls: (
      await Promise.all(extras.coverKeys.map((key) => signedUrlOrNull(key)))
    ).filter((url): url is string => Boolean(url)),
    createdAt: collection.createdAt.toISOString(),
    updatedAt: collection.updatedAt.toISOString(),
  }
}
