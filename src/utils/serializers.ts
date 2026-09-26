import type {
  AvatarDocument,
  CollectionDocument,
  LookDocument,
  UserDocument,
} from '../types/mongo.js'
import { signedUrlOrNull } from './storage.js'

export function serializeUser(user: UserDocument) {
  return {
    id: user._id.toString(),
    email: user.email,
    firstName: user.firstName,
    hasPassword: Boolean(user.passwordHash),
    emailVerified: Boolean(user.emailVerifiedAt),
    createdAt: user.createdAt.toISOString(),
  }
}

export async function serializeAvatar(avatar: AvatarDocument) {
  const [avatarUrl, selfieUrl, bodyPhotoUrl, previewUrl, versions] = await Promise.all([
    signedUrlOrNull(avatar.avatarKey),
    signedUrlOrNull(avatar.selfieKey),
    signedUrlOrNull(avatar.bodyPhotoKey ?? null),
    signedUrlOrNull(avatar.job?.previewKey ?? null),
    Promise.all(
      (avatar.versions ?? []).map(async (version) => ({
        id: version.id,
        url: await signedUrlOrNull(version.key),
        source: version.source,
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
    colorAnalysis: avatar.colorAnalysis,
    avatarUrl,
    selfieUrl,
    bodyPhotoUrl,
    versions,
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
    createdAt: look.createdAt.toISOString(),
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
