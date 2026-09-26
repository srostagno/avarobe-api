import type { ObjectId } from 'mongodb'

export type UserDocument = {
  _id: ObjectId
  email: string
  firstName: string
  createdAt: Date
  updatedAt: Date
  lastLoginAt: Date | null
  emailVerifiedAt: Date | null
  // Hash of the nonce in the latest sign-in link. Cleared when the link is
  // used, so each link works once and a new link voids older ones.
  loginNonceHash?: string | null
}

export type RefreshTokenDocument = {
  _id: ObjectId
  tokenHash: string
  userId: ObjectId
  expiresAt: Date
  revokedAt: Date | null
  replacedByTokenHash: string | null
  createdAt: Date
  createdByIp: string | null
  userAgent: string | null
}

export type Presentation = 'menswear' | 'womenswear' | 'unisex'

export type BodyBuild =
  | 'slim'
  | 'athletic'
  | 'average'
  | 'broad'
  | 'curvy'
  | 'plus'

export type AvatarBody = {
  heightCm: number
  weightKg: number
  build: BodyBuild
  presentation: Presentation
}

export type ColorSwatch = {
  name: string
  hex: string
}

export type ColorAnalysis = {
  season: string
  undertone: 'warm' | 'cool' | 'neutral' | 'olive'
  contrast: 'low' | 'medium' | 'high'
  summary: string
  bestColors: ColorSwatch[]
  neutrals: ColorSwatch[]
  avoidColors: ColorSwatch[]
  metals: 'gold' | 'silver' | 'both'
  confidence: 'low' | 'medium' | 'high'
  photoNote: string | null
}

export type GenerationStatus = 'processing' | 'ready' | 'failed'

export type AvatarDocument = {
  _id: ObjectId
  userId: ObjectId
  status: GenerationStatus
  error: string | null
  selfieKey: string
  avatarKey: string | null
  body: AvatarBody
  colorAnalysis: ColorAnalysis | null
  consentVersion: string
  consentAt: Date
  generations: number
  createdAt: Date
  updatedAt: Date
  readyAt: Date | null
}

export type LookItemSlot =
  | 'top'
  | 'layer'
  | 'outerwear'
  | 'bottom'
  | 'dress'
  | 'suit'
  | 'shoes'
  | 'accessory'
  | 'bag'

export type LookItem = {
  slot: LookItemSlot
  name: string
  color: string
  colorHex: string
  material: string
  fit: string
}

export type LookPlan = {
  title: string
  vibe: string
  summary: string
  whyItWorks: string
  items: LookItem[]
  stylingTips: string[]
}

export type LookDocument = {
  _id: ObjectId
  userId: ObjectId
  avatarId: ObjectId
  batchId: ObjectId
  occasion: {
    text: string
    dressCode: string
    summary: string
  }
  plan: LookPlan
  status: GenerationStatus
  error: string | null
  imageKey: string | null
  collectionIds: ObjectId[]
  favorite: boolean
  createdAt: Date
  updatedAt: Date
  readyAt: Date | null
}

export type CollectionDocument = {
  _id: ObjectId
  userId: ObjectId
  name: string
  createdAt: Date
  updatedAt: Date
}

export type UsageCounterDocument = {
  _id: string
  userId: ObjectId
  kind: 'avatar' | 'look'
  day: string
  count: number
  expireAt: Date
}
