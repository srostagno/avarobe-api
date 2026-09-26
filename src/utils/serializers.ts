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
    createdAt: user.createdAt.toISOString(),
  }
}

export async function serializeAvatar(avatar: AvatarDocument) {
  const [avatarUrl, selfieUrl] = await Promise.all([
    signedUrlOrNull(avatar.avatarKey),
    signedUrlOrNull(avatar.selfieKey),
  ])

  return {
    id: avatar._id.toString(),
    status: avatar.status,
    error: avatar.error,
    body: avatar.body,
    colorAnalysis: avatar.colorAnalysis,
    avatarUrl,
    selfieUrl,
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
    status: look.status,
    error: look.error,
    imageUrl: await signedUrlOrNull(look.imageKey),
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
