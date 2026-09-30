import type {
  AvatarDocument,
  CollectionDocument,
  LookDocument,
  UserDocument,
} from '../types/mongo.js'
import { currentHair } from '../modules/avatar/hair.js'
import { serializeBilling } from '../modules/billing/entitlements.js'
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
    email: user.email,
    firstName: user.firstName,
    focus: focusOf(user),
    hasPassword: Boolean(user.passwordHash),
    emailVerified: Boolean(user.emailVerifiedAt),
    emailTips: !user.emailTipsOptOutAt,
    billing: serializeBilling(user),
    createdAt: user.createdAt.toISOString(),
  }
}

// Without the Color Report the palette shows the season and a first taste of
// colors; the rest stays on the server, with counts so the page can hint at it.
function serializeColorAnalysis(analysis: AvatarDocument['colorAnalysis'], full: boolean) {
  if (!analysis || full) {
    return analysis ? { ...analysis, locked: false } : null
  }

  return {
    season: analysis.season,
    undertone: analysis.undertone,
    contrast: analysis.contrast,
    summary: analysis.summary,
    bestColors: analysis.bestColors.slice(0, 3),
    neutrals: [],
    avoidColors: [],
    metals: analysis.metals,
    confidence: analysis.confidence,
    photoNote: analysis.photoNote,
    locked: true,
    lockedCounts: {
      bestColors: Math.max(0, analysis.bestColors.length - 3),
      neutrals: analysis.neutrals.length,
      avoidColors: analysis.avoidColors.length,
    },
  }
}

export async function serializeAvatar(avatar: AvatarDocument, options: { fullPalette: boolean }) {
  const [avatarUrl, selfieUrl, bodyPhotoUrl, previewUrl, drapePreviewUrl, versions] = await Promise.all([
    signedUrlOrNull(avatar.avatarKey),
    signedUrlOrNull(avatar.selfieKey),
    signedUrlOrNull(avatar.bodyPhotoKey ?? null),
    signedUrlOrNull(avatar.job?.previewKey ?? null),
    signedUrlOrNull(avatar.drapePreview?.status === 'ready' ? avatar.drapePreview.key : null),
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
    colorAnalysis: serializeColorAnalysis(avatar.colorAnalysis, options.fullPalette),
    // Free for everyone: their best and worst color on their face.
    drapePreview: avatar.drapePreview
      ? {
          status: avatar.drapePreview.status,
          url: drapePreviewUrl,
          best: avatar.drapePreview.best,
          worst: avatar.drapePreview.worst,
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
